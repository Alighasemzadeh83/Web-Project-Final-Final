"use client";

import useSWR from "swr";
import { api, endpoints } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function PursuitsPage() {
  const { user } = useAuth();
  const endpoint = user ? endpoints.pursuitsHighAlert : endpoints.pursuitsPublicHighAlert;
  const { data } = useSWR(endpoint, fetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: true,
  });
  const dataLoading = data === undefined;
  const pursuits = data || [];
  const statusLabel = (status?: string) => {
    if (status === "criminal_high_alert") return "criminal_high_alert";
    if (!status) return "high_alert";
    return status;
  };
  if (dataLoading) {
    return <PageSkeleton title="Loading high alert board" cards={3} lines={3} />;
  }
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="pill">High Alert</div>
        <h3 style={{ margin: "8px 0 4px" }}>Most wanted suspects</h3>
        <p className="muted" style={{ margin: 0 }}>
          Each row is one suspect-case pair. Ranking follows max(L) × max(D), and reward is rank × 20,000,000 rials.
        </p>
        <div className="action-row" style={{ marginTop: 10 }}>
          <span className="tag">{user ? "Internal view" : "Public view"}</span>
        </div>
      </div>
      <div className="grid" style={{ gap: 12 }}>
        {pursuits.map((item: any) => {
          const suspect = item.suspect;
          const caseInfo = item.case || {};
          const severity = item.severity_at_report || "unknown";
          const status = item.status || "high_alert";
          const days = item.days_under_pursuit;
          return (
          <div key={item.pursuit_id || `${caseInfo?.id}-${suspect?.id}`} className="card">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div className="muted">
                  Case: {caseInfo?.title || "Untitled case"}{caseInfo?.number ? ` (${caseInfo.number})` : ""}
                </div>
                <h3 style={{ margin: "4px 0" }}>{suspect?.full_name || "Suspect"}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Status: {statusLabel(status)} | Severity: {severity}
                  {days !== undefined ? ` | Days: ${days}` : ""}
                </p>
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  Rank score: {(item.rank_score || 0).toLocaleString()} (Max days: {(item.max_days_under_pursuit || 0).toLocaleString()} · Max severity: {(item.max_severity_score || 0).toLocaleString()})
                </p>
              </div>
              <div className="pill">Reward {(item.reward || 0).toLocaleString()} Rials</div>
            </div>
            {suspect?.photo_url ? (
              <div style={{ marginTop: 12 }}>
                <img
                  src={suspect.photo_url}
                  alt="Suspect"
                  style={{ width: "100%", maxWidth: 320, borderRadius: 12, border: "1px solid var(--border)" }}
                />
              </div>
            ) : null}
          </div>
        )})}
        {!pursuits.length && <div className="empty">No high alert pursuits.</div>}
      </div>
    </div>
  );
}
