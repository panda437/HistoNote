import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertServiceSecret } from "./security";

export const byEmail = query({
  args: { secret: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
  },
});

export const create = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) throw new Error("An account with this email already exists");

    return await ctx.db.insert("users", {
      email,
      name: args.name.trim(),
      passwordHash: args.passwordHash,
      createdAt: Date.now(),
    });
  },
});
