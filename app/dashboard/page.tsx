import Link from "next/link";
import Dashboard from "./Dashboard";

export default function DashboardPage() {
  return (
    <main>
      <p>
        <Link href="/">← LendLoop</Link>
      </p>
      <h1>Dashboard</h1>
      <Dashboard />
    </main>
  );
}
