import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSession } from "./security";

export const currentUser = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    try {
      const user = await requireSession(ctx, args.sessionToken);
      return { _id: user._id, name: user.name, email: user.email };
    } catch {
      return null;
    }
  },
});

export const signOut = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.sessionToken))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

export const getUserForSession = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    return { _id: user._id, name: user.name, email: user.email };
  },
});

export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of existing) {
      if (session.expiresAt <= Date.now()) await ctx.db.delete(session._id);
    }
    await ctx.db.insert("sessions", {
      userId: args.userId,
      token: args.token,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
  },
});
