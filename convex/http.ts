import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { todayUtc } from "./dates";
import { verifySignature } from "./hmac";

const http = httpRouter();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function isAuthentic(request: Request, body: string) {
  return await verifySignature({
    secret: process.env.N8N_WEBHOOK_SECRET,
    ts: request.headers.get("x-lendloop-timestamp"),
    sig: request.headers.get("x-lendloop-signature"),
    method: request.method,
    path: new URL(request.url).pathname,
    body,
  });
}

// n8n -> Convex: list overdue loans (minimal fields, signed GET).
http.route({
  path: "/overdue",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await isAuthentic(request, ""))) return json({ error: "unauthorized" }, 401);
    const items = await ctx.runQuery(internal.loans.overdue, { today: todayUtc() });
    return json({ items });
  }),
});

// n8n -> Convex: write back the reminder result. Idempotent on reminderId.
http.route({
  path: "/reminder-result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    if (!(await isAuthentic(request, body))) return json({ error: "unauthorized" }, 401);

    let data: { loanId?: unknown; reminderId?: unknown; status?: unknown; detail?: unknown };
    try {
      data = JSON.parse(body);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    const { loanId, reminderId, status, detail } = data;
    if (typeof loanId !== "string" || typeof reminderId !== "string" || (status !== "sent" && status !== "failed")) {
      return json({ error: "invalid payload" }, 400);
    }
    try {
      const result = await ctx.runMutation(internal.notify.recordReminder, {
        loanId,
        reminderId,
        status,
        detail: typeof detail === "string" ? detail : undefined,
      });
      return json({ ok: true, ...result });
    } catch {
      return json({ error: "unknown loan" }, 404);
    }
  }),
});

export default http;
