"use client";

import Link from "next/link";
import useSWR from "swr";
import { api, endpoints } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { hasAnyRole, roleNames } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const { data: metrics } = useSWR(endpoints.metrics, fetcher);
  const metricsLoading = metrics === undefined;
  if (loading) {
    return <PageSkeleton title="Checking access" cards={3} lines={2} />;
  }
  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Please sign in to access your dashboard.</p>
      </div>
    );
  }
  const modules = [
    {
      title: "Cases",
      href: "/cases",
      desc: "Browse active cases and their details.",
      roles: ["Cadet", "Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief", "Coroner"],
    },
    { title: "Complaints", href: "/complaints", desc: "Submit or review complaints.", roles: ["*"] },
    { title: "Evidence Registry", href: "/evidence", desc: "Register evidence and review forensic files.", roles: ["Officer", "Detective", "Sergeant", "Coroner"] },
    { title: "Detective Board", href: "/board", desc: "Organize notes, links, and evidence maps.", roles: ["Detective"] },
    { title: "High Alert", href: "/pursuits", desc: "Monitor top pursuits and rewards.", roles: ["Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief"] },
    { title: "Rewards", href: "/tips", desc: "Submit tips and manage reward payouts.", roles: ["*"] },
    { title: "Reports", href: "/reports", desc: "Full case summaries and reporting.", roles: ["Judge"] },
  ];
  const roles = roleNames(user);

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="card">
        <div className="pill">Dashboard</div>
        <h2 style={{ margin: "10px 0 6px" }}>
          Welcome, {user?.first_name || user?.username || "Officer"}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Your modules are tailored to your role: {roles.length ? roles.join(", ") : "General Access"}.
        </p>
        <p className="muted" style={{ marginTop: 6 }}>
          Missing modules usually mean your role does not have access or the API is not enabled for that workflow yet.
        </p>
        <div className="action-row" style={{ marginTop: 12 }}>
          <span className="tag">Active cases: {metricsLoading ? "Loading..." : metrics?.active_cases ?? "—"}</span>
          <span className="tag">Solved: {metricsLoading ? "Loading..." : metrics?.solved_cases ?? "—"}</span>
          <span className="tag">Personnel: {metricsLoading ? "Loading..." : metrics?.total_personnel ?? "—"}</span>
        </div>
      </div>
      <div className="grid grid-3 stagger">
        {modules
          .filter((m) => (m.roles.includes("*") ? true : hasAnyRole(user, m.roles)))
          .map((m, index) => (
            <ModuleCard
              key={m.title}
              title={m.title}
              href={m.href}
              badge={m.title === "Cases" ? metrics?.active_cases : undefined}
              desc={m.desc}
              index={index}
            />
          ))}
      </div>
      <div className="card">
        <h3 style={{ margin: "0 0 6px" }}>Planned modules</h3>
        <p className="muted" style={{ margin: 0 }}>
          These will appear when their APIs are ready for your role.
        </p>
        <div className="action-row" style={{ marginTop: 10 }}>
          {["Payments", "Trial Decisions"].map((label) => (
            <span key={label} className="tag">{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModuleCard({
  title,
  href,
  desc,
  badge,
  index,
}: {
  title: string;
  href: string;
  desc: string;
  badge?: number;
  index: number;
}) {
  return (
    <Link href={href} className="card" style={{ position: "relative", display: "block", ["--stagger-index" as any]: index }}>
      <h3 style={{ margin: "0 0 6px" }}>
        {title} {badge !== undefined && <span className="pill">{badge}</span>}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {desc}
      </p>
    </Link>
  );
}
