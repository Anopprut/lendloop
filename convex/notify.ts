import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { hmacHex, signingString } from "./hmac";

const MAX_ATTEMPTS = 5;

export const buildPayload = internalQuery({
  args: { loanId: v.id("loans"), event: v.string() },
  handler: async (ctx, { loanId, event }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const [tool, borrower, lender] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.borrowerId),
      ctx.db.get(loan.lenderId),
    ]);
    if (!tool || !borrower || !lender) return null;

    // New requests notify the lender; every status change notifies the borrower.
    const recipient = event === "request_created" ? lender : borrower;
    // Data minimization: only what the notification needs, no ids of other users, no description.
    return {
      event,
      loanId,
      toolName: tool.name,
      status: loan.status,
      startDate: loan.startDate,
      endDate: loan.endDate,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
    };
  },
});

export const recordEvent = internalMutation({
  args: {
    loanId: v.id("loans"),
    kind: v.string(),
    status: v.union(v.literal("sent"), v.literal("retrying"), v.literal("failed")),
    key: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", args.key)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { status: args.status, detail: args.detail, at: Date.now() });
      return { duplicate: existing.status === "sent" && args.status === "sent" };
    }
    await ctx.db.insert("automationEvents", { ...args, at: Date.now() });
    return { duplicate: false };
  },
});

/** Idempotent write-back from the n8n reminder workflow. */
export const recordReminder = internalMutation({
  args: { loanId: v.string(), reminderId: v.string(), status: v.union(v.literal("sent"), v.literal("failed")), detail: v.optional(v.string()) },
  handler: async (ctx, { loanId, reminderId, status, detail }) => {
    const id = ctx.db.normalizeId("loans", loanId);
    if (!id) throw new Error("Unknown loan");
    const key = `reminder:${reminderId}`;
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (existing?.status === "sent") return { duplicate: true }; // replay or retry: no second write
    const safeDetail = detail?.slice(0, 200);
    if (existing) {
      await ctx.db.patch(existing._id, { status, detail: safeDetail, at: Date.now() });
    } else {
      await ctx.db.insert("automationEvents", { loanId: id, kind: "reminder", status, key, detail: safeDetail, at: Date.now() });
    }
    return { duplicate: false };
  },
});

/** Calls the n8n webhook with a signed payload; retries with backoff and logs every outcome. */
export const send = internalAction({
  args: { loanId: v.id("loans"), event: v.string(), attempt: v.optional(v.number()) },
  handler: async (ctx, { loanId, event, attempt = 1 }) => {
    const key = `notify:${loanId}:${event}`;
    const kind = `notify:${event}`;
    const log = (status: "sent" | "retrying" | "failed", detail?: string) =>
      ctx.runMutation(internal.notify.recordEvent, { loanId, kind, status, key, detail });

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await log("failed", "N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET is not set");
      return;
    }

    const payload = await ctx.runQuery(internal.notify.buildPayload, { loanId, event });
    if (!payload) {
      await log("failed", "loan data not found");
      return;
    }

    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const path = new URL(url).pathname;
    const signature = await hmacHex(secret, signingString(ts, "POST", path, body));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": ts,
          "x-lendloop-signature": signature,
        },
        body,
      });
      if (!res.ok) throw new Error(`n8n responded ${res.status}`);
      await log("sent");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await log("retrying", `attempt ${attempt} failed: ${message}`);
        const delayMs = 2 ** attempt * 5_000; // 10s, 20s, 40s, 80s
        await ctx.scheduler.runAfter(delayMs, internal.notify.send, { loanId, event, attempt: attempt + 1 });
      } else {
        await log("failed", `gave up after ${attempt} attempts: ${message}`);
      }
    }
  },
});
