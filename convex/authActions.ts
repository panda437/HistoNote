"use node";

import { compare, hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const SESSION_AGE_MS = 12 * 60 * 60 * 1000;

type SessionResult = {
  token: string;
  user: { _id: Id<"users">; name: string; email: string };
};

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("Enter a valid email address");
  return normalized;
}

async function issueSession(ctx: ActionCtx, user: Doc<"users">): Promise<SessionResult> {
  const token = randomBytes(32).toString("base64url");
  await ctx.runMutation(internal.auth.createSession, {
    userId: user._id,
    token,
    expiresAt: Date.now() + SESSION_AGE_MS,
  });
  return {
    token,
    user: { _id: user._id, name: user.name, email: user.email },
  };
}

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<SessionResult> => {
    const email = normalizeEmail(args.email);
    const user: Doc<"users"> | null = await ctx.runQuery(internal.users.byEmail, { email });
    if (!user || !(await compare(args.password, user.passwordHash))) {
      throw new Error("Incorrect email or password");
    }
    return await issueSession(ctx, user);
  },
});

export const signUp = action({
  args: { name: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<SessionResult> => {
    const name = args.name.trim();
    const email = normalizeEmail(args.email);
    if (name.length < 2 || name.length > 80) throw new Error("Enter your full name");
    if (args.password.length < 8 || args.password.length > 128) {
      throw new Error("Password must be between 8 and 128 characters");
    }
    const passwordHash = await hash(args.password, 12);
    const userId = await ctx.runMutation(internal.users.create, {
      name,
      email,
      passwordHash,
    });
    const user: Doc<"users"> | null = await ctx.runQuery(internal.users.byEmail, { email });
    if (!user || user._id !== userId) throw new Error("Could not create account");
    return await issueSession(ctx, user);
  },
});
