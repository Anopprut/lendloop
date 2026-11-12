"use client";

import Link from "next/link";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export default function Home() {
  // Public board: the server returns only name and category, never owner details.
  const tools = useQuery(api.tools.publicList);

  return (
    <main>
      <header className="row between">
        <div>
          <h1>LendLoop</h1>
          <p className="muted">Borrow what you need. Lend what you don&apos;t.</p>
        </div>
        <div>
          <Unauthenticated>
            <SignInButton mode="modal">
              <button>Sign in to lend or borrow</button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <div className="row">
              <Link href="/dashboard">Open dashboard</Link>
              <UserButton />
            </div>
          </Authenticated>
        </div>
      </header>

      <h2>Available tools</h2>
      {tools === undefined && <p>Loading…</p>}
      {tools?.length === 0 && <p className="muted">No tools listed yet.</p>}
      <ul className="cards">
        {tools?.map((t, i) => (
          <li key={i}>
            <b>{t.name}</b> <span className="pill">{t.category}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
