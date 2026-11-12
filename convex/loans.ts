import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { isValidDate, rangesOverlap, todayUtc } from "./dates";
import { requireAdmin, requireUser } from "./lib";

async function enrich(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, borrower, lender, events] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.borrowerId),
    ctx.db.get(loan.lenderId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .take(5),
  ]);
  return {
    _id: loan._id,
    toolName: tool?.name ?? "(removed)",
    borrowerName: borrower?.name ?? "Unknown",
    lenderName: lender?.name ?? "Unknown",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < todayUtc(),
    // Bonus: recent automation activity (notifications, reminders) per loan.
    automation: events.map((e) => ({ kind: e.kind, status: e.status, at: e.at, detail: e.detail })),
  };
}

async function approvedLoansFor(ctx: QueryCtx | MutationCtx, toolId: Doc<"tools">["_id"]) {
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
  return loans.filter((l) => l.status === "approved");
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    if (!isValidDate(startDate) || !isValidDate(endDate)) throw new Error("Dates must be YYYY-MM-DD");
    if (startDate > endDate) throw new Error("Start date must not be after end date");
    if (startDate < todayUtc()) throw new Error("Start date cannot be in the past");

    const tool = await ctx.db.get(toolId);
    if (!tool) throw new Error("Tool not found");
    if (tool.ownerId === me._id) throw new Error("You cannot borrow your own tool");

    const wanted = { startDate, endDate };
    if ((await approvedLoansFor(ctx, toolId)).some((l) => rangesOverlap(l, wanted))) {
      throw new Error("The tool is already booked for those dates");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      borrowerId: me._id,
      lenderId: tool.ownerId,
      startDate,
      endDate,
      status: "requested",
    });
    await ctx.scheduler.runAfter(0, internal.notify.send, { loanId, event: "request_created" });
    return loanId;
  },
});

export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approved"), v.literal("declined")) },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Request not found");
    if (loan.lenderId !== me._id) throw new Error("Only the lender can decide on this request");
    if (loan.status !== "requested") throw new Error("This request was already handled");

    if (decision === "approved") {
      const others = await approvedLoansFor(ctx, loan.toolId);
      if (others.some((l) => rangesOverlap(l, loan))) throw new Error("Dates overlap an approved loan");
    }
    await ctx.db.patch(loanId, { status: decision });
    await ctx.scheduler.runAfter(0, internal.notify.send, { loanId, event: decision });
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Loan not found");
    if (loan.lenderId !== me._id) throw new Error("Only the lender can mark a loan as returned");
    if (loan.status !== "approved") throw new Error("Only approved loans can be returned");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.notify.send, { loanId, event: "returned" });
  },
});

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", me._id)).order("desc").collect();
    return await Promise.all(loans.map((l) => enrich(ctx, l)));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_lender", (q) => q.eq("lenderId", me._id)).order("desc").collect();
    return await Promise.all(loans.map((l) => enrich(ctx, l)));
  },
});

export const adminAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return await Promise.all(loans.map((l) => enrich(ctx, l)));
  },
});

/** Used by the daily n8n reminder workflow via the signed HTTP endpoint. Minimal fields only. */
export const overdue = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const approved = await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "approved")).collect();
    const items = [];
    for (const loan of approved) {
      if (loan.endDate >= today) continue;
      const reminderId = `${loan._id}:${today}`;
      const done = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("key", `reminder:${reminderId}`))
        .unique();
      if (done?.status === "sent") continue; // already reminded today
      const [tool, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.borrowerId)]);
      if (!tool || !borrower) continue;
      items.push({
        reminderId,
        loanId: loan._id,
        toolName: tool.name,
        borrowerName: borrower.name,
        borrowerEmail: borrower.email,
        endDate: loan.endDate,
      });
    }
    return items;
  },
});
