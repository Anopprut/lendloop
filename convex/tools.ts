import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { CATEGORIES, CONDITIONS, cleanText, requireUser } from "./lib";

const category = v.string();
const condition = v.string();

function checkEnums(cat: string, cond: string) {
  if (!(CATEGORIES as readonly string[]).includes(cat)) throw new Error("Invalid category");
  if (!(CONDITIONS as readonly string[]).includes(cond)) throw new Error("Invalid condition");
}

/** Public board: name and category only. No owner details, no ids. */
export const publicList = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(100);
    return tools.map((t) => ({ name: t.name, category: t.category }));
  },
});

/** Signed-in view with availability, optionally filtered by category. */
export const list = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, { category: cat }) => {
    const me = await requireUser(ctx);
    const tools = cat
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", cat)).collect()
      : await ctx.db.query("tools").order("desc").collect();

    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", t._id)).collect();
        const onLoan = loans.some((l) => l.status === "approved");
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: t.ownerId === me._id,
          availability: onLoan ? "on loan" : "available",
        };
      }),
    );
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).collect();
  },
});

export const create = mutation({
  args: { name: v.string(), category, condition, description: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    checkEnums(args.category, args.condition);
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name: cleanText(args.name, "Name", 80),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", 500),
    });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), name: v.string(), category, condition, description: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new Error("Tool not found");
    if (tool.ownerId !== me._id) throw new Error("You can only edit your own listings");
    checkEnums(args.category, args.condition);
    await ctx.db.patch(args.toolId, {
      name: cleanText(args.name, "Name", 80),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", 500),
    });
  },
});

async function deleteTool(ctx: MutationCtx, toolId: Id<"tools">) {
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
  if (loans.some((l) => l.status === "approved")) {
    throw new Error("This tool is currently on loan");
  }
  for (const l of loans) {
    if (l.status === "requested") await ctx.db.patch(l._id, { status: "declined" });
  }
  await ctx.db.delete(toolId);
}

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new Error("Tool not found");
    // Owners delete their own listings; admins may remove any listing.
    if (tool.ownerId !== me._id && me.role !== "admin") {
      throw new Error("You can only delete your own listings");
    }
    await deleteTool(ctx, toolId);
  },
});
