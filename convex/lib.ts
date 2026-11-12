import type { MutationCtx, QueryCtx } from "./_generated/server";

export const CATEGORIES = ["power tools", "garden", "kitchen", "camping", "other"] as const;
export const CONDITIONS = ["new", "good", "fair", "worn"] as const;

type Ctx = QueryCtx | MutationCtx;

/** Authentication + authorization live here, on the server, not in the UI. */
export async function requireUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new Error("User not registered");
  return user;
}

export async function requireAdmin(ctx: Ctx) {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new Error("Admin only");
  return user;
}

export function cleanText(value: string, field: string, max: number): string {
  const v = value.trim();
  if (v.length === 0) throw new Error(`${field} is required`);
  if (v.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return v;
}
