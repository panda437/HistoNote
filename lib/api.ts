import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function requireUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export function apiError(error: unknown, fallback = "Something went wrong") {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found/i.test(message) ? 404 : /unauthorized/i.test(message) ? 401 : 400;
  return NextResponse.json({ error: message || fallback }, { status });
}
