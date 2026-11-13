import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib";
import { v } from "convex/values";

/** Creates or refreshes the user row. Only callable from server code (the `sync` action below). */
export const upsert = internalMutation({
  args: { tokenIdentifier: v.string(), email: v.string(), name: v.string() },
  handler: async (ctx, { tokenIdentifier, email, name }) => {
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const role = email && admins.includes(email.toLowerCase()) ? "admin" : "user";
    const displayName = name || email.split("@")[0] || "Neighbor";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.email !== email || existing.name !== displayName || existing.role !== role) {
        await ctx.db.patch(existing._id, { email, name: displayName, role });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", { tokenIdentifier, email, name: displayName, role, trustedLender: false });
  },
});

/**
 * Called after sign-in. The email and name come from the verified Clerk token when it carries them;
 * otherwise they are looked up server-side with the Clerk Backend API. Nothing is taken from the client.
 */
export const sync = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    let email = identity.email ?? "";
    let name = identity.name ?? "";
    const secret = process.env.CLERK_SECRET_KEY;
    if ((!email || !name) && secret) {
      const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(identity.subject)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (res.ok) {
        const u = (await res.json()) as {
          first_name?: string | null;
          last_name?: string | null;
          primary_email_address_id?: string | null;
          email_addresses?: { id: string; email_address: string }[];
        };
        email ||= u.email_addresses?.find((e) => e.id === u.primary_email_address_id)?.email_address ?? "";
        name ||= [u.first_name, u.last_name].filter(Boolean).join(" ");
      }
    }
    await ctx.runMutation(internal.users.upsert, { tokenIdentifier: identity.tokenIdentifier, email, name });
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
