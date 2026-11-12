import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib";
import { v } from "convex/values";

/** Called once after sign-in. Creates or refreshes the user row. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const email = identity.email ?? "";
    const name = identity.name ?? email.split("@")[0] ?? "Neighbor";
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const role = admins.includes(email.toLowerCase()) ? "admin" : "user";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      if (existing.email !== email || existing.name !== name || existing.role !== role) {
        await ctx.db.patch(existing._id, { email, name, role });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      name,
      role,
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    return user ? { _id: user._id, name: user.name, role: user.role, trustedLender: user.trustedLender } : null;
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

export const listLenders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({ _id: u._id, name: u.name, role: u.role, trustedLender: u.trustedLender }));
  },
});
