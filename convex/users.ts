import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
  },
});

export const create = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
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
