import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { hmacHex, signingString, timestampIsFresh, timingSafeEqual, verifySignature } from "../convex/hmac.ts";

const secret = "test-secret";
const body = JSON.stringify({ loanId: "abc", status: "sent" });

test("matches Node's crypto HMAC (the implementation n8n uses)", async () => {
  const msg = signingString("1700000000", "POST", "/reminder-result", body);
  const expected = createHmac("sha256", secret).update(msg).digest("hex");
  assert.equal(await hmacHex(secret, msg), expected);
});

test("accepts a correctly signed, fresh request", async () => {
  const nowMs = 1_700_000_100_000;
  const ts = "1700000100";
  const sig = await hmacHex(secret, signingString(ts, "POST", "/reminder-result", body));
  assert.ok(await verifySignature({ secret, ts, sig, method: "POST", path: "/reminder-result", body, nowMs }));
});

test("rejects tampered body, wrong path, wrong method and wrong secret", async () => {
  const nowMs = 1_700_000_100_000;
  const ts = "1700000100";
  const sig = await hmacHex(secret, signingString(ts, "POST", "/reminder-result", body));
  const base = { ts, sig, method: "POST", path: "/reminder-result", body, nowMs, secret };
  assert.ok(!(await verifySignature({ ...base, body: body + " " })));
  assert.ok(!(await verifySignature({ ...base, path: "/overdue" })));
  assert.ok(!(await verifySignature({ ...base, method: "GET" })));
  assert.ok(!(await verifySignature({ ...base, secret: "other" })));
});

test("rejects stale timestamps and missing headers", async () => {
  const ts = "1700000000";
  const sig = await hmacHex(secret, signingString(ts, "GET", "/overdue", ""));
  const nowMs = (1700000000 + 301) * 1000;
  assert.ok(!(await verifySignature({ secret, ts, sig, method: "GET", path: "/overdue", body: "", nowMs })));
  assert.ok(!(await verifySignature({ secret, ts: null, sig, method: "GET", path: "/overdue", body: "" })));
  assert.ok(!(await verifySignature({ secret: undefined, ts, sig, method: "GET", path: "/overdue", body: "" })));
});

test("helpers", () => {
  assert.ok(timingSafeEqual("abc", "abc"));
  assert.ok(!timingSafeEqual("abc", "abd"));
  assert.ok(!timingSafeEqual("abc", "ab"));
  assert.ok(timestampIsFresh("1700000000", 1_700_000_000_000));
  assert.ok(!timestampIsFresh("not-a-number"));
});
