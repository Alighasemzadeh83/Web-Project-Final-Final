"use client";

import useSWR from "swr";
import { useAuth } from "../../lib/useAuth";
import { api, endpoints } from "../../lib/api";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const { data: statusData } = useSWR(user ? endpoints.suspectStatus : null, fetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: true,
  });
  const statusLoading = !!user && statusData === undefined;

  if (loading) {
    return <PageSkeleton title="Loading profile" cards={2} lines={3} />;
  }

  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Please sign in to view your profile.</p>
      </div>
    );
  }
  if (statusLoading) {
    return <PageSkeleton title="Loading legal status" cards={2} lines={3} />;
  }

  const assignedRoles = user.roles?.map((r) => r.name) || [];
  const roles = user.is_superuser ? ["Superuser (Django)", ...assignedRoles] : assignedRoles.length ? assignedRoles : ["Citizen"];
  const accountType = user.is_superuser ? "Django superuser" : assignedRoles.includes("Administrator") ? "Administrator" : "User";
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "—";
  const suspect = statusData?.suspect;
  const criminal = statusData?.criminal;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="section-title">
          <div>
            <div className="pill">Profile</div>
            <h3 style={{ margin: "8px 0 4px" }}>User information</h3>
            <p className="muted" style={{ margin: 0 }}>
              Review your account details and assigned roles.
            </p>
          </div>
        </div>
      </div>

      <div className="card grid" style={{ gap: 10 }}>
        <div className="grid grid-2">
          <div>
            <div className="muted">Username</div>
            <div>{user.username}</div>
          </div>
          <div>
            <div className="muted">Full name</div>
            <div>{fullName}</div>
          </div>
        </div>
        <div className="grid grid-2">
          <div>
            <div className="muted">First name</div>
            <div>{user.first_name || "—"}</div>
          </div>
          <div>
            <div className="muted">Last name</div>
            <div>{user.last_name || "—"}</div>
          </div>
        </div>
        <div className="grid grid-2">
          <div>
            <div className="muted">Email</div>
            <div>{user.email || "—"}</div>
          </div>
          <div>
            <div className="muted">Phone</div>
            <div>{user.phone_number || "—"}</div>
          </div>
        </div>
        <div className="grid grid-2">
          <div>
            <div className="muted">National ID</div>
            <div>{user.national_id || "—"}</div>
          </div>
          <div>
            <div className="muted">Account type</div>
            <div>{accountType}</div>
          </div>
        </div>
        <div>
          <div className="muted">Roles</div>
          <div className="action-row">
            {roles.map((role) => (
              <span key={role} className="tag">{role}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="card grid" style={{ gap: 10 }}>
        <div className="section-title">
          <div>
            <div className="pill">Legal Status</div>
            <h3 style={{ margin: "8px 0 4px" }}>Suspect / Criminal classification</h3>
            <p className="muted" style={{ margin: 0 }}>
              Suspect status is active after sergeant approval. Criminal status is active after court verdict.
            </p>
          </div>
        </div>
        <div className="grid grid-2">
          <div className="card" style={{ margin: 0 }}>
            <div className="muted">Suspect status</div>
            {suspect?.active ? (
              <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                <div className="action-row">
                  <span className="tag">{suspect.level === "critical" ? "Critical" : `Level ${suspect.level ?? "—"}`}</span>
                  {suspect.max_severity_label && <span className="tag">{suspect.max_severity_label}</span>}
                </div>
                {(suspect.cases || []).map((item: any) => (
                  <div key={`suspect-case-${item.id}`} className="muted">
                    {item.title || "Untitled case"}{item.number ? ` (${item.number})` : ""}
                  </div>
                ))}
                {!suspect.cases?.length && suspect.case_ids?.length ? (
                  <div className="muted">{`Cases: ${suspect.case_ids.join(", ")}`}</div>
                ) : null}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 6 }}>No active suspect record.</div>
            )}
          </div>
          <div className="card" style={{ margin: 0 }}>
            <div className="muted">Criminal status</div>
            {criminal?.active ? (
              <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                <div className="action-row">
                  <span className="tag">{criminal.level === "critical" ? "Critical" : `Level ${criminal.level ?? "—"}`}</span>
                  {criminal.max_severity_label && <span className="tag">{criminal.max_severity_label}</span>}
                </div>
                {(criminal.cases || []).map((item: any) => (
                  <div key={`criminal-case-${item.id}`} className="muted">
                    {item.title || "Untitled case"}{item.number ? ` (${item.number})` : ""}
                  </div>
                ))}
                {!criminal.cases?.length && criminal.case_ids?.length ? (
                  <div className="muted">{`Cases: ${criminal.case_ids.join(", ")}`}</div>
                ) : null}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 6 }}>No criminal verdict recorded.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
