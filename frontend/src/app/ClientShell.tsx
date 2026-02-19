"use client";

import Link from "next/link";
import { AuthProvider, useAuth } from "../lib/useAuth";
import { api, endpoints, getApiErrorMessage } from "../lib/api";
import { useEffect, useState } from "react";
import { hasAnyRole } from "../lib/roles";

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [hasSuperuser, setHasSuperuser] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string>("");

  useEffect(() => {
    api
      .get(endpoints.superuserStatus)
      .then((res) => setHasSuperuser(!!res.data?.has_superuser))
      .catch((err) => setStatusError(getApiErrorMessage(err, "Unable to check superuser status")));
  }, []);

  if (hasSuperuser === null) {
    return <FullscreenLoader title="Loading frontend" subtitle="Preparing the application..." />;
  }

  if (hasSuperuser === false) {
    return (
      <div className="shell">
        <div className="card" style={{ maxWidth: 720, margin: "80px auto" }}>
          <div className="pill">Setup Required</div>
          <h2 style={{ margin: "12px 0 6px" }}>No superuser found</h2>
          <p className="muted" style={{ margin: 0 }}>
            The system is locked until a superuser is created by the site supporter.
          </p>
          <div className="card" style={{ marginTop: 16 }}>
            <p className="muted" style={{ marginBottom: 8 }}>Run this command on the server:</p>
            <div className="tag">python3 manage.py createsuperuser</div>
          </div>
          <div className="action-row" style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <ShellContent statusError={statusError}>{children}</ShellContent>
    </AuthProvider>
  );
}

function ShellContent({ statusError, children }: { statusError: string; children: React.ReactNode }) {
  const { loading } = useAuth();

  if (loading) {
    return <FullscreenLoader title="Loading frontend" subtitle="Checking access..." />;
  }

  return (
    <div className="shell">
      <Header statusError={statusError} />
      {children}
    </div>
  );
}

function FullscreenLoader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="fullscreen-loader">
      <div className="card loader-card">
        <div className="loader-spinner" />
        <h3 style={{ margin: "4px 0 2px" }}>{title}</h3>
        <p className="muted" style={{ margin: 0 }}>{subtitle}</p>
      </div>
    </div>
  );
}

function Header({ statusError }: { statusError: string }) {
  const { user, logout, loading } = useAuth();
  const isAdmin = !!user?.is_superuser || hasAnyRole(user, ["Administrator"]);
  const roleNames = user?.roles?.map((role) => role.name) || [];
  const roleLabels = user?.is_superuser ? ["Superuser (Django)", ...roleNames] : roleNames;
  const rolesLabel = roleLabels.length ? roleLabels.join(", ") : "Citizen";
  const todayLabel = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

  const navItems = [
    { label: "Home", href: "/", roles: [] },
    { label: "Dashboard", href: "/dashboard", roles: ["*"] },
    { label: "Cases", href: "/cases", roles: ["Cadet", "Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief", "Coroner"] },
    { label: "Complaints", href: "/complaints", roles: ["*"] },
    { label: "Field Reports", href: "/field-reports", roles: ["Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief"] },
    { label: "Profile", href: "/profile", roles: ["*"] },
    { label: "Evidence", href: "/evidence", roles: ["Officer", "Detective", "Sergeant", "Coroner"] },
    { label: "Detective Board", href: "/board", roles: ["Detective"] },
    { label: "High Alert", href: "/pursuits", roles: [] },
    { label: "Payments", href: "/payments", roles: ["*"] },
    { label: "Rewards", href: "/tips", roles: ["*"] },
    { label: "Reports & Judge", href: "/reports", roles: ["Judge"] },
  ];
  const adminHidden = new Set(["Field Reports", "Status Center", "Evidence", "Detective Board", "Reports"]);
  const canSee = (roles: string[]) => {
    if (!roles.length) return true;
    if (user?.is_superuser) return true;
    if (roles.includes("*")) return !!user;
    return hasAnyRole(user, roles);
  };
  return (
    <header className="topbar">
      <div className="topbar-main">
        <Link href="/" className="brand has-tip" data-tip="Return to home" title="Return to home">
          <span className="brand-mark" />
          PCM Console
        </Link>
        <nav className="nav">
          {navItems.filter((item) => !(isAdmin && adminHidden.has(item.label)) && canSee(item.roles)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="has-tip"
              data-tip={item.label}
              title={item.label}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="topbar-actions">
        {loading ? (
          <span className="tag">Checking access…</span>
        ) : user ? (
          <>
            <span className="tag has-tip" data-tip="Today's date" title="Today's date">
              {todayLabel}
            </span>
            {isAdmin && (
              <Link
                href="/admin-tools"
                className="btn secondary has-tip"
                data-tip="Open admin tools"
                title="Open admin tools"
              >
                Admin Tools
              </Link>
            )}
            <span className="tag has-tip" data-tip="Logged-in user and role" title="Logged-in user and role">
              {`${user.username} : ${rolesLabel}`}
            </span>
            <button className="btn secondary has-tip" data-tip="Sign out of the console" title="Sign out of the console" onClick={logout}>
              Logout
            </button>
          </>
        ) : (
          <Link href="/auth" className="btn secondary has-tip" data-tip="Login or register" title="Login or register">
            Login
          </Link>
        )}
      </div>
      {statusError && <span className="tag">{statusError}</span>}
    </header>
  );
}
