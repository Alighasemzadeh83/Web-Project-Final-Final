"use client";

import useSWR from "swr";
import { api, endpoints } from "../lib/api";
import Link from "next/link";
import { useAuth } from "../lib/useAuth";
import { hasAnyRole } from "../lib/roles";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function Home() {
  const { user } = useAuth();
  const { data: metrics } = useSWR(endpoints.metrics, fetcher);
  const metricsLoading = metrics === undefined;
  const metricCards = [
    { label: "Solved Cases", value: metrics?.solved_cases ?? "—" },
    { label: "Active Cases", value: metrics?.active_cases ?? "—" },
    { label: "Total Personnel", value: metrics?.total_personnel ?? "—" },
  ];
  const showMetrics = metricCards.length > 0;

  const canSee = (roles: string[]) => {
    if (!roles.length) return true;
    if (!user) return false;
    if (user.is_superuser) return true;
    return hasAnyRole(user, roles);
  };

  const featureCards = [
    {
      title: "Role-Aware Dashboard",
      text: "Your modules adapt to your rank: cadet review, officer approvals, detective board, or judge reports.",
      href: "/dashboard",
      roles: ["*"],
      public: false,
    },
    {
      title: "Evidence & Pursuit",
      text: "Register evidence, review forensic files, and monitor high-alert suspects.",
      href: "/evidence",
      roles: ["Officer", "Detective", "Sergeant", "Coroner"],
      public: false,
    },
  ];
  return (
    <div className="grid" style={{ gap: 28 }}>
      <div className="card fade-in">
        <div className="pill">Police Case Management</div>
        <h1 style={{ margin: "12px 0 6px", fontSize: 38 }}>Integrated Operations Desk</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          This system centralizes complaints, field reports, evidence validation, suspect pursuit, and court verdicts.
          Every role sees only the modules relevant to their duties, so the workflow stays focused and secure.
        </p>
        <div className="action-row">
          {!user && <Link href="/auth" className="btn">Login</Link>}
          {user && <Link href="/dashboard" className="btn secondary">Open Dashboard</Link>}
          <Link href="/pursuits" className="btn secondary">High Alert Board</Link>
        </div>
      </div>
      {showMetrics && (
        <div className="grid grid-3 stagger">
          {metricsLoading
            ? Array.from({ length: 3 }).map((_, index) => (
                <div key={`metric-skeleton-${index}`} className="card" style={{ ["--stagger-index" as any]: index }}>
                  <div className="skeleton-line" style={{ width: "48%" }} />
                  <div className="skeleton-line skeleton-title" style={{ width: "32%", marginTop: 14 }} />
                </div>
              ))
            : metricCards.map((item, index) => (
                <div key={item.label} className="card" style={{ ["--stagger-index" as any]: index }}>
                  <div className="muted">{item.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{item.value}</div>
                </div>
              ))}
        </div>
      )}
      <div className="grid grid-3">
        {featureCards
          .filter((card) => {
            if (card.public) return true;
            if (card.roles.includes("*")) return !!user;
            return canSee(card.roles);
          })
          .map((card) => (
            <FeatureCard key={card.title} title={card.title} text={card.text} href={card.href} />
          ))}
      </div>
    </div>
  );
}

function FeatureCard({ title, text, href }: { title: string; text: string; href: string }) {
  return (
    <Link href={href} className="card" style={{ display: "block" }}>
      <h3 style={{ margin: "0 0 8px" }}>{title}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {text}
      </p>
    </Link>
  );
}
