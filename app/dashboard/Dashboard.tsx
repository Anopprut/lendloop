"use client";

import { useEffect, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const CATEGORIES = ["power tools", "garden", "kitchen", "camping", "other"];
const CONDITIONS = ["new", "good", "fair", "worn"];

type Tab = "tools" | "listings" | "requests" | "incoming" | "admin";

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      // Convex wraps server errors; show the readable tail.
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.split("Uncaught Error:").pop()?.split("\n")[0]?.trim() ?? msg);
    }
  };
  return { error, run };
}

// Defense in depth: the proxy/middleware redirects, this guards the client, and Convex enforces access on the server.
export default function Dashboard() {
  return (
    <>
      <AuthLoading>
        <p>Loading…</p>
      </AuthLoading>
      <Unauthenticated>
        <p>
          Please{" "}
          <SignInButton mode="modal">
            <button>sign in</button>
          </SignInButton>{" "}
          to continue.
        </p>
      </Unauthenticated>
      <Authenticated>
        <DashboardInner />
      </Authenticated>
    </>
  );
}

function DashboardInner() {
  const store = useMutation(api.users.store);
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<Tab>("tools");

  useEffect(() => {
    void store();
  }, [store]);

  if (me === undefined) return <p>Loading…</p>;
  if (me === null) return <p>Setting up your account…</p>;

  const tabs: [Tab, string][] = [
    ["tools", "All tools"],
    ["listings", "My listings"],
    ["requests", "My requests"],
    ["incoming", "Incoming requests"],
  ];
  if (me.role === "admin") tabs.push(["admin", "Admin"]);

  return (
    <>
      <p className="muted">
        Signed in as <b>{me.name}</b> ({me.role}
        {me.trustedLender ? ", trusted lender" : ""})
      </p>
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "tools" && <ToolsTab />}
      {tab === "listings" && <ListingsTab />}
      {tab === "requests" && <LoanList kind="requests" />}
      {tab === "incoming" && <LoanList kind="incoming" />}
      {tab === "admin" && me.role === "admin" && <AdminTab />}
    </>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

function ToolsTab() {
  const [category, setCategory] = useState("");
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const request = useMutation(api.loans.request);
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  const { error, run } = useAction();

  return (
    <section>
      <label>
        Category{" "}
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <ErrorLine error={error} />
      {tools === undefined && <p>Loading…</p>}
      {tools?.length === 0 && <p className="muted">No tools yet.</p>}
      <ul className="cards">
        {tools?.map((t) => {
          const d = dates[t._id] ?? { start: "", end: "" };
          return (
            <li key={t._id}>
              <b>{t.name}</b> <span className="pill">{t.category}</span>{" "}
              <span className={`pill ${t.availability === "available" ? "ok" : "warn"}`}>{t.availability}</span>
              <div className="muted">
                {t.condition} · {t.ownerName}
                {t.ownerTrusted ? " ✓ Trusted Lender" : ""}
              </div>
              <div>{t.description}</div>
              {!t.isMine && (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => request({ toolId: t._id, startDate: d.start, endDate: d.end }));
                  }}
                >
                  <input type="date" required value={d.start} onChange={(e) => setDates({ ...dates, [t._id]: { ...d, start: e.target.value } })} />
                  <input type="date" required value={d.end} onChange={(e) => setDates({ ...dates, [t._id]: { ...d, end: e.target.value } })} />
                  <button>Request to borrow</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ToolForm(props: {
  initial?: { name: string; category: string; condition: string; description: string };
  submitLabel: string;
  onSubmit: (v: { name: string; category: string; condition: string; description: string }) => Promise<unknown>;
}) {
  const [v, setV] = useState(props.initial ?? { name: "", category: CATEGORIES[0], condition: CONDITIONS[1], description: "" });
  const { error, run } = useAction();
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await props.onSubmit(v);
          if (!props.initial) setV({ name: "", category: CATEGORIES[0], condition: CONDITIONS[1], description: "" });
        });
      }}
    >
      <input required maxLength={80} placeholder="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
        {CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value })}>
        {CONDITIONS.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <input required maxLength={500} placeholder="Short description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <button>{props.submitLabel}</button>
      <ErrorLine error={error} />
    </form>
  );
}

function ListingsTab() {
  const listings = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const { error, run } = useAction();

  return (
    <section>
      <h3>List a tool</h3>
      <ToolForm submitLabel="List tool" onSubmit={(v) => create(v)} />
      <h3>My listings</h3>
      <ErrorLine error={error} />
      {listings?.length === 0 && <p className="muted">You have not listed anything yet.</p>}
      <ul className="cards">
        {listings?.map((t) => (
          <li key={t._id}>
            {editing === t._id ? (
              <ToolForm
                initial={{ name: t.name, category: t.category, condition: t.condition, description: t.description }}
                submitLabel="Save"
                onSubmit={async (v) => {
                  await update({ toolId: t._id, ...v });
                  setEditing(null);
                }}
              />
            ) : (
              <>
                <b>{t.name}</b> <span className="pill">{t.category}</span>
                <div className="muted">{t.condition}</div>
                <div>{t.description}</div>
                <div className="row">
                  <button onClick={() => setEditing(t._id)}>Edit</button>
                  <button className="danger" onClick={() => void run(() => remove({ toolId: t._id }))}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoanList({ kind }: { kind: "requests" | "incoming" }) {
  const mine = useQuery(api.loans.myRequests, kind === "requests" ? {} : "skip");
  const incoming = useQuery(api.loans.incoming, kind === "incoming" ? {} : "skip");
  const loans = kind === "requests" ? mine : incoming;
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  const { error, run } = useAction();

  return (
    <section>
      <ErrorLine error={error} />
      {loans === undefined && <p>Loading…</p>}
      {loans?.length === 0 && <p className="muted">Nothing here yet.</p>}
      <ul className="cards">
        {loans?.map((l) => (
          <li key={l._id}>
            <b>{l.toolName}</b> <span className={`pill ${l.overdue ? "warn" : ""}`}>{l.overdue ? "overdue" : l.status}</span>
            <div className="muted">
              {l.startDate} → {l.endDate} · {kind === "requests" ? `lender: ${l.lenderName}` : `borrower: ${l.borrowerName}`}
            </div>
            {kind === "incoming" && l.status === "requested" && (
              <div className="row">
                <button onClick={() => void run(() => decide({ loanId: l._id, decision: "approved" }))}>Approve</button>
                <button className="danger" onClick={() => void run(() => decide({ loanId: l._id, decision: "declined" }))}>
                  Decline
                </button>
              </div>
            )}
            {kind === "incoming" && l.status === "approved" && (
              <button onClick={() => void run(() => markReturned({ loanId: l._id }))}>Mark as returned</button>
            )}
            <Automation events={l.automation} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Automation({ events }: { events: { kind: string; status: string; at: number; detail?: string }[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="automation">
      {events.map((e, i) => (
        <li key={i} className={e.status === "failed" ? "error" : "muted"}>
          {e.kind} · {e.status} · {new Date(e.at).toLocaleString()}
          {e.detail ? ` · ${e.detail}` : ""}
        </li>
      ))}
    </ul>
  );
}

function AdminTab() {
  const tools = useQuery(api.tools.list, {});
  const loans = useQuery(api.loans.adminAll);
  const users = useQuery(api.users.listLenders);
  const remove = useMutation(api.tools.remove);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { error, run } = useAction();

  return (
    <section>
      <ErrorLine error={error} />
      <h3>Lenders</h3>
      <ul className="cards">
        {users?.map((u) => (
          <li key={u._id} className="row">
            <span>
              {u.name} <span className="pill">{u.role}</span>
            </span>
            <button onClick={() => void run(() => setTrusted({ userId: u._id, trusted: !u.trustedLender }))}>
              {u.trustedLender ? "Remove Trusted Lender" : "Mark Trusted Lender"}
            </button>
          </li>
        ))}
      </ul>
      <h3>All listings</h3>
      <ul className="cards">
        {tools?.map((t) => (
          <li key={t._id} className="row">
            <span>
              {t.name} · {t.ownerName}
            </span>
            <button className="danger" onClick={() => void run(() => remove({ toolId: t._id }))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <h3>All loans</h3>
      <ul className="cards">
        {loans?.map((l) => (
          <li key={l._id}>
            <b>{l.toolName}</b> <span className="pill">{l.overdue ? "overdue" : l.status}</span>
            <div className="muted">
              {l.borrowerName} ← {l.lenderName} · {l.startDate} → {l.endDate}
            </div>
            <Automation events={l.automation} />
          </li>
        ))}
      </ul>
    </section>
  );
}
