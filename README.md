# LendLoop

A neighborhood tool-lending board with automated workflows. Neighbors list tools, request to borrow them for a date range, lenders approve or decline, and n8n sends notifications and daily overdue reminders.

**Stack:** Next.js (App Router) · TypeScript · Clerk (auth) · Convex (database, server functions, HTTP endpoints) · n8n (automation, self-hosted with Docker)

## What it does
- **Public page:** company name, tagline, a read-only list of tools (name and category only, from Convex, no owner details) and a "Sign in to lend or borrow" button (Clerk).
- **Signed-in users:** list, edit and delete their own tools; request a tool for a date range; approve or decline incoming requests; mark a loan as returned. Views: All tools (filter by category, shows availability), My listings, My requests, Incoming requests.
- **Admins:** remove any listing, see all loans, mark a lender as "Trusted Lender".
- **Automation (n8n):** a notification workflow and a daily overdue-reminder workflow, each with signed requests, retries and an error workflow. Each loan shows its recent automation activity.

## Architecture

```
Browser ──Clerk JWT──> Next.js ──Convex client──> Convex (queries / mutations)
                                                    │  mutation schedules action
                                                    ▼
                       n8n  <──signed POST────  notify.send (retries with backoff, logs every attempt)
                        │
   daily 09:00 ─────────┤ signed GET  /overdue          ──> Convex HTTP endpoint
                        └ signed POST /reminder-result  ──> Convex HTTP endpoint (idempotent)
```

| Path | Role |
|---|---|
| `convex/schema.ts` | users, tools, loans, automationEvents |
| `convex/lib.ts` | `requireUser` / `requireAdmin`, input cleaning |
| `convex/tools.ts`, `loans.ts`, `users.ts` | public API, every function checks the caller on the server |
| `convex/notify.ts` | builds a minimal payload, signs it, calls n8n, retries, logs |
| `convex/http.ts` | `GET /overdue` and `POST /reminder-result`, both HMAC-verified |
| `convex/hmac.ts`, `dates.ts` | pure helpers with unit tests |
| `n8n/*.json` | exported workflows (notifications, overdue reminders, error handler) |
| `docker-compose.yml` | local n8n |

## Security and data-minimization decisions
- **Access control is enforced in Convex functions, not the UI.** Hiding a button is never relied on. Owners can edit or delete only their own tools; only the lender can approve, decline or mark a return; admins can remove any listing and manage Trusted Lenders.
- **Roles are never taken from the client.** `role` is derived on the server from the `ADMIN_EMAILS` allowlist when the user row is created or refreshed.
- **The public query returns only `name` and `category`** (no ids, no owner). Signed-in views add the owner's display name and Trusted Lender flag, nothing else (no email).
- **Webhook payloads contain only what the notification needs:** event, tool name, status, dates, and the recipient's name and email. No other user's data, no descriptions.
- **HMAC-SHA256 in both directions.** Signed string: `timestamp.METHOD.path.body`. The receiver checks a constant-time comparison and rejects timestamps older than 5 minutes. Method and path are part of the signature, so a signature for one endpoint cannot be replayed against another.
- **n8n verifies on the exact raw bytes** of the body (Webhook node `rawBody`), not a re-serialized JSON object.
- **Secrets only in environment variables:** Convex env vars and the n8n container environment. Nothing is committed (`.env*` is git-ignored; the exported workflows contain no secrets).
- **Idempotent write-backs:** each reminder has a deterministic `reminderId` (`loanId:YYYY-MM-DD`). The write-back stores it as a unique key, so retries and replays do not create duplicates, and `/overdue` skips loans already reminded that day.
- **Validation:** dates are strict `YYYY-MM-DD`, start must not be in the past, overlapping approved loans are rejected, text fields are trimmed and length-limited, categories and conditions come from an allowlist.
- **Reliability and visibility:** Convex retries the n8n call up to 5 times with exponential backoff and records `sent`, `retrying` or `failed` in `automationEvents`, shown on each loan. In n8n, the HTTP nodes retry 3 times and a separate error workflow logs any failed execution. Nothing fails silently.

## Local setup

Prerequisites: Node 22+, Docker, a free [Clerk](https://clerk.com) application and a free [Convex](https://convex.dev) project.

1. **Install:** `npm install`
2. **Convex:** run `npx convex dev` and follow the prompts. It creates the deployment, writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local` and generates `convex/_generated`.
3. **Clerk:** create an application, copy the publishable and secret keys into `.env.local`, then activate the **Convex integration** in the Clerk dashboard. Copy the Clerk Frontend API URL.
4. **Convex environment variables** (dashboard, Settings, Environment Variables, or `npx convex env set NAME value`): `CLERK_JWT_ISSUER_DOMAIN`, `ADMIN_EMAILS`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` (see `.env.example`).
5. **n8n:** create `.env` next to `docker-compose.yml` with `LENDLOOP_WEBHOOK_SECRET` (same value as `N8N_WEBHOOK_SECRET`) and `CONVEX_SITE_URL` (the `.convex.site` URL), then `docker compose up -d` and open http://localhost:5678.
   - Import the three files in `n8n/`.
   - In **Loan notifications**, open the workflow settings and set **Error workflow** to *LendLoop - Error handler*. Do the same for *Overdue reminders*. Then activate both workflows (the production webhook path is `/webhook/lendloop-loan-event`).
6. **Run the app:** `npm run dev`, open http://localhost:3000.

Generate a secret with `openssl rand -hex 32`.

### Tests
```
npm test        # HMAC, date logic, and the exact n8n Code-node JavaScript checked against Convex's verifier
npm run typecheck
```

### Notifications
The workflows log the message in a Code node (a logged mock, as the brief allows). To send real messages, replace the "Compose notification (mock)" and "Send reminder (mock)" nodes with an Email (SMTP), Slack or Discord node.

## What I would change to run this in production
- **Identity:** keep roles in Clerk organization roles or a dedicated admin table rather than an email allowlist; require verified emails.
- **n8n:** run on a managed or hardened instance behind TLS with queue mode and a Postgres backend; use n8n credentials for provider keys; restrict the webhook by IP allowlist or a gateway in addition to HMAC.
- **Secrets:** a secret manager with rotation; support two active HMAC secrets during rotation; add nonce tracking if strict replay prevention is needed.
- **Reliability:** a dead-letter view and alert (Slack/pager) driven from `automationEvents`; rate limiting on mutations; pagination instead of `collect()` and `take(200)`.
- **Privacy:** a retention policy for loans and automation logs, account deletion/export, and a data-processing review for what is sent to the notification provider.
- **Quality:** end-to-end tests (Playwright) against a Convex test deployment, CI (lint, typecheck, tests) and Convex deployment previews.
- **Time zones:** overdue is calculated in UTC date strings; store the neighborhood's time zone.
