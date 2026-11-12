// Runs the Code-node JavaScript that ships in the n8n workflow JSON against Convex's HMAC helpers,
// so the two sides are proven to agree on the signing format without needing a running n8n.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hmacHex, signingString, verifySignature } from "../convex/hmac.ts";

const require = createRequire(import.meta.url);
const SECRET = "shared-secret";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function codeOf(file: string, nodeName: string): string {
  const wf = JSON.parse(readFileSync(new URL(`../n8n/${file}`, import.meta.url), "utf8"));
  return wf.nodes.find((n: { name: string }) => n.name === nodeName).parameters.jsCode;
}

async function runCode(code: string, ctx: { input: unknown[]; rawBody?: string }) {
  const fn = new AsyncFunction("require", "$input", "$env", code);
  const $input = { first: () => ctx.input[0], all: () => ctx.input };
  const thisArg = { helpers: { getBinaryDataBuffer: async () => Buffer.from(ctx.rawBody ?? "", "utf8") } };
  return await fn.call(thisArg, require, $input, { LENDLOOP_WEBHOOK_SECRET: SECRET });
}

const PATH = "/webhook/lendloop-loan-event";
const payload = JSON.stringify({ event: "approved", loanId: "l1", toolName: "Drill" });

async function convexSigned(body: string, tsOffsetSec = 0) {
  const ts = String(Math.floor(Date.now() / 1000) + tsOffsetSec);
  return { ts, sig: await hmacHex(SECRET, signingString(ts, "POST", PATH, body)) };
}

test("n8n accepts a webhook call signed by Convex", async () => {
  const { ts, sig } = await convexSigned(payload);
  const out = await runCode(codeOf("loan-notifications.json", "Verify signature"), {
    input: [{ json: { headers: { "x-lendloop-timestamp": ts, "x-lendloop-signature": sig } } }],
    rawBody: payload,
  });
  assert.equal(out[0].json.valid, true);
  assert.equal(out[0].json.payload.event, "approved");
});

test("n8n rejects tampered bodies, stale timestamps and missing signatures", async () => {
  const code = codeOf("loan-notifications.json", "Verify signature");
  const { ts, sig } = await convexSigned(payload);
  const headers = { "x-lendloop-timestamp": ts, "x-lendloop-signature": sig };

  const tampered = await runCode(code, { input: [{ json: { headers } }], rawBody: payload.replace("approved", "declined") });
  assert.equal(tampered[0].json.valid, false);

  const stale = await convexSigned(payload, -1000);
  const staleOut = await runCode(code, {
    input: [{ json: { headers: { "x-lendloop-timestamp": stale.ts, "x-lendloop-signature": stale.sig } } }],
    rawBody: payload,
  });
  assert.equal(staleOut[0].json.valid, false);

  const missing = await runCode(code, { input: [{ json: { headers: {} } }], rawBody: payload });
  assert.equal(missing[0].json.valid, false);
});

test("Convex accepts GET /overdue signed by the n8n workflow", async () => {
  const [{ json }] = await runCode(codeOf("overdue-reminders.json", "Sign GET /overdue"), { input: [{ json: {} }] });
  assert.ok(await verifySignature({ secret: SECRET, ts: json.ts, sig: json.sig, method: "GET", path: "/overdue", body: "" }));
});

test("Convex accepts POST /reminder-result signed by the n8n workflow, and rejects a swapped body", async () => {
  const item = { json: { loanId: "l1", reminderId: "l1:2026-11-12", status: "sent" } };
  const [{ json }] = await runCode(codeOf("overdue-reminders.json", "Sign POST /reminder-result"), { input: [item] });
  const base = { secret: SECRET, ts: json.ts, sig: json.sig, method: "POST", path: "/reminder-result" };
  assert.ok(await verifySignature({ ...base, body: json.body }));
  assert.ok(!(await verifySignature({ ...base, body: json.body.replace("sent", "failed") })));
});
