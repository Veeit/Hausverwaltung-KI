import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { eq } from "drizzle-orm";
import { buildUserContent, loadTriggerInfo } from "@/agent/context";
import { buildSystemPrompt } from "@/agent/prompt";
import { buildAgentTools, type AgentToolContext, type AgentToolSpec } from "@/agent/tools";
import type { sendSmtp } from "@/channel/smtp";
import { getDb } from "@/db/client";
import { escalations, messages } from "@/db/schema";

export interface RunToolsParams {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  toolSpecs: AgentToolSpec[];
}

export interface AgentRunDeps {
  runTools?: (params: RunToolsParams) => Promise<{ stopReason: string | null }>;
  sendFn?: typeof sendSmtp;
}

async function defaultRunTools({ system, content, toolSpecs }: RunToolsParams): Promise<{ stopReason: string | null }> {
  const client = new Anthropic(); // liest ANTHROPIC_API_KEY
  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    max_iterations: 16,
    system,
    tools: toolSpecs.map((s) => betaZodTool({ name: s.name, description: s.description, inputSchema: s.inputSchema as never, run: s.run })),
    messages: [{ role: "user", content }],
  });
  return { stopReason: finalMessage.stop_reason };
}

export async function runAgentOnMessage(messageId: number, deps: AgentRunDeps = {}): Promise<void> {
  const db = getDb();
  const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
  if (!message) return;

  db.update(messages).set({ processingStatus: "processing" }).where(eq(messages.id, messageId)).run();

  try {
    const trigger = loadTriggerInfo(messageId);
    const ctx: AgentToolContext = {
      kind: trigger.kind,
      conversationId: trigger.message.conversationId,
      triggerMessageId: trigger.message.id,
      tenant: trigger.tenant
        ? { id: trigger.tenant.id, name: trigger.tenant.name, email: trigger.tenant.email }
        : null,
      contractor: trigger.contractor
        ? { id: trigger.contractor.id, name: trigger.contractor.name, email: trigger.contractor.email }
        : null,
      ticketId: trigger.ticket?.id ?? null,
      repliedToTenant: false,
      sendFn: deps.sendFn,
    };
    const toolSpecs = buildAgentTools(ctx);
    const system = buildSystemPrompt(trigger);
    const content = buildUserContent(trigger);
    const runTools = deps.runTools ?? defaultRunTools;

    const { stopReason } = await runTools({ system, content, toolSpecs });

    if (stopReason === "refusal") {
      db.insert(escalations)
        .values({
          ticketId: ctx.ticketId,
          conversationId: ctx.conversationId,
          question: "KI-Antwort wurde aus Sicherheitsgründen abgelehnt — bitte Vorgang manuell prüfen.",
        })
        .run();
    }

    if (trigger.kind === "tenant_message" && !ctx.repliedToTenant) {
      db.insert(escalations)
        .values({
          ticketId: ctx.ticketId,
          conversationId: ctx.conversationId,
          question: `Die KI hat auf die Mieter-Nachricht #${messageId} keine Antwort gesendet — bitte prüfen.`,
        })
        .run();
    }

    db.update(messages)
      .set({ processingStatus: "done", processingError: null })
      .where(eq(messages.id, messageId))
      .run();
  } catch (err) {
    const attempts = message.processingAttempts + 1;
    db.update(messages)
      .set({
        processingAttempts: attempts,
        processingStatus: attempts >= 3 ? "failed" : "pending",
        processingError: String(err),
      })
      .where(eq(messages.id, messageId))
      .run();
  }
}
