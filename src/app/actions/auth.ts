"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, sha256Hex } from "@/lib/auth";

export async function requireAuth(): Promise<void> {
  const cookieStore = await cookies();
  const value = cookieStore.get(AUTH_COOKIE)?.value;
  const expected = await sha256Hex(process.env.DASHBOARD_PASSWORD ?? "");
  if (value !== expected) {
    redirect("/login");
  }
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const expectedPassword = process.env.DASHBOARD_PASSWORD ?? "";
  if (expectedPassword === "" || password !== expectedPassword) {
    redirect("/login?fehler=1");
  }
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, await sha256Hex(password), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  redirect("/login");
}
