"use client";

import { FormEvent, useState } from "react";
import useSWR from "swr";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import RoleGate from "../../components/RoleGate";
import { hasAnyRole } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

type Witness = {
  national_id: string;
  phone_number: string;
};

export default function FieldReportsPage() {
  const { user } = useAuth();
  const isDetective = hasAnyRole(user, ["Detective"]);
  const isSergeant = hasAnyRole(user, ["Sergeant"]);
  const isCaptain = hasAnyRole(user, ["Captain"]);
  const isChief = hasAnyRole(user, ["Chief"]);
  const isSupervisor = isDetective || isSergeant || isCaptain || isChief;
  const { data: fieldReportsData, mutate: refreshReports } = useSWR(
    user ? endpoints.fieldReports : null,
    (url: string) => api.get(url).then((r) => r.data)
  );
  const isDataLoading = !!user && fieldReportsData === undefined;
  const reviewQueue = (fieldReportsData?.results || []).filter((r: any) =>
    isSupervisor ? r.status === "pending" && r.created_by !== user?.id : false
  );
  const myReports = (fieldReportsData?.results || []).filter((r: any) => r.created_by === user?.id);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [severity, setSeverity] = useState("level_3");
  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [errorDialog, setErrorDialog] = useState<string[] | null>(null);

  const humanizeLine = (line: string) => {
    let next = line;
    next = next.replace(/non_field_errors:?/gi, "");
    next = next.replace(/witnesses\./gi, "Witness ");
    next = next.replace(/national_id/gi, "National ID");
    next = next.replace(/phone_number/gi, "Phone number");
    next = next.replace(/number/gi, "Case number");
    next = next.replace(/detail:?/gi, "");
    next = next.replace(/message:?/gi, "");
    return next.trim().replace(/\s+/g, " ");
  };

  const openErrorDialog = (message: string) => {
    const parts = message.split("|").map((part) => humanizeLine(part)).filter(Boolean);
    setErrorDialog(parts.length ? parts : ["Something went wrong."]);
  };

  const formatErrorMessage = (err: any, fallback = "Request failed.") => getApiErrorMessage(err, fallback);

  const addWitness = () => {
    setWitnesses([...witnesses, { national_id: "", phone_number: "" }]);
  };

  const removeWitness = (idx: number) => {
    setWitnesses(witnesses.filter((_, i) => i !== idx));
  };

  const updateWitness = (idx: number, field: keyof Witness, value: string) => {
    const next = [...witnesses];
    next[idx] = { ...next[idx], [field]: value };
    setWitnesses(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setOk("");
    try {
      const cleanedWitnesses = witnesses
        .map((w) => ({
          national_id: w.national_id.trim(),
          phone_number: w.phone_number.trim(),
        }))
        .filter((w) => w.national_id || w.phone_number);
      await api.post(endpoints.fieldReports, {
        title,
        description,
        location,
        occurred_at: occurredAt || null,
        severity,
        witness_inputs: cleanedWitnesses,
      });
      setTitle("");
      setDescription("");
      setLocation("");
      setOccurredAt("");
      setSeverity("level_3");
      setWitnesses([]);
      setOk("Field report submitted and sent for approval.");
      await refreshReports();
    } catch (ex: any) {
      openErrorDialog(formatErrorMessage(ex, "Failed to submit field report."));
    }
  };

  if (isDataLoading) {
    return (
      <RoleGate roles={["Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief"]}>
        <PageSkeleton title="Loading field reports" cards={3} lines={3} />
      </RoleGate>
    );
  }

  const approveReport = async (id: number) => {
    try {
      await api.post(`${endpoints.fieldReports}${id}/approve/`, { note: "" });
      refreshReports();
    } catch (ex: any) {
      openErrorDialog(formatErrorMessage(ex));
    }
  };

  const rejectReport = async (id: number) => {
    try {
      await api.post(`${endpoints.fieldReports}${id}/reject/`, { note: "" });
      refreshReports();
    } catch (ex: any) {
      openErrorDialog(formatErrorMessage(ex));
    }
  };

  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Please sign in to file a crime scene report.</p>
      </div>
    );
  }

  return (
    <RoleGate roles={["Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief"]}>
      <div className="grid" style={{ gap: 16 }}>
        {isSupervisor && (
          <div className="card">
            <div className="section-title">
              <div>
                <div className="pill">Pending approvals</div>
                <h3 style={{ margin: "8px 0 4px" }}>Field reports waiting for review</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Any police rank higher than the reporter can approve or reject a field report.
                </p>
              </div>
            </div>
            <div className="grid" style={{ gap: 12, marginTop: 12 }}>
              {reviewQueue.map((c: any) => (
                <div key={c.id} className="card" style={{ margin: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <h4 style={{ margin: 0 }}>{c.title || "Untitled case"}</h4>
                      <div className="muted">{c.number ? `Case code: ${c.number}` : "Case code: —"}</div>
                    </div>
                    <span className="pill">{c.status}</span>
                  </div>
                  <p className="muted" style={{ marginTop: 8 }}>{c.description}</p>
                  <div className="action-row">
                    <button className="btn secondary" onClick={() => rejectReport(c.id)}>Reject</button>
                    <button className="btn" onClick={() => approveReport(c.id)}>Approve</button>
                  </div>
                </div>
              ))}
              {!reviewQueue.length && <div className="empty">No pending field reports.</div>}
            </div>
          </div>
        )}
        <div className="card">
          <div className="section-title">
            <div>
              <div className="pill">Your reports</div>
              <h3 style={{ margin: "8px 0 4px" }}>Submitted field reports</h3>
              <p className="muted" style={{ margin: 0 }}>
                You can see the current status of every report you have submitted.
              </p>
            </div>
          </div>
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            {myReports.map((r: any) => (
              <div key={r.id} className="card" style={{ margin: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <h4 style={{ margin: 0 }}>{r.title || "Untitled case"}</h4>
                    <div className="muted">{r.number ? `Case code: ${r.number}` : "Case code: —"}</div>
                  </div>
                  <span className="pill">{r.status}</span>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>{r.description}</p>
              </div>
            ))}
            {!myReports.length && <div className="empty">No field reports submitted yet.</div>}
          </div>
        </div>
        <div className="card">
          <div className="section-title">
            <div>
              <div className="pill">Field Report</div>
              <h3 style={{ margin: "8px 0 4px" }}>Crime scene report</h3>
              <p className="muted" style={{ margin: 0 }}>
                Use this form when a police officer reports a scene directly (not a citizen complaint).
              </p>
            </div>
          </div>
        </div>

        <form className="card grid" style={{ gap: 10 }} onSubmit={submit}>
          <label className="muted">
            Title
            <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
          </label>
          <input
            required
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
          />
          <label className="muted">
            Description
            <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
          </label>
          <textarea
            required
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="textarea"
          />
          <div className="grid grid-3">
            <input
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input"
            />
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="input"
            />
            <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="level_3">Level 3</option>
              <option value="level_2">Level 2</option>
              <option value="level_1">Level 1</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              <div>
                <div className="pill">Witnesses</div>
                <h4 style={{ margin: "8px 0 0" }}>Witness list</h4>
                <p className="muted" style={{ margin: 0 }}>
                  Witnesses must already be registered users. Provide national ID and phone number.
                </p>
              </div>
            </div>
            <div className="grid" style={{ gap: 12 }}>
              {!witnesses.length && (
                <div className="muted">
                  Reporter is recorded as a witness by default. Add more only if needed.
                </div>
              )}
              {witnesses.map((w, idx) => (
                <div key={idx} className="card" style={{ margin: 0 }}>
                  <div className="grid grid-2">
                    <input
                      placeholder="National ID"
                      value={w.national_id}
                      onChange={(e) => updateWitness(idx, "national_id", e.target.value)}
                      className="input"
                    />
                    <input
                      placeholder="Phone number"
                      value={w.phone_number}
                      onChange={(e) => updateWitness(idx, "phone_number", e.target.value)}
                      className="input"
                    />
                  </div>
                  <div className="action-row" style={{ marginTop: 8 }}>
                    <button className="btn secondary" type="button" onClick={() => removeWitness(idx)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button className="btn secondary" type="button" onClick={addWitness}>
                Add witness
              </button>
            </div>
          </div>

          {ok && <div style={{ color: "var(--success)" }}>{ok}</div>}
          <button className="btn" type="submit">
            Submit report
          </button>
        </form>
        {errorDialog && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 10, 6, 0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: 24,
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: 520,
                width: "100%",
                border: "1px solid rgba(186, 48, 0, 0.25)",
                boxShadow: "0 24px 60px rgba(15, 10, 6, 0.35)",
              }}
            >
              <div className="section-title" style={{ marginBottom: 8 }}>
                <div>
                  <div className="pill" style={{ background: "rgba(186, 48, 0, 0.12)", color: "#b03711" }}>
                    Validation error
                  </div>
                  <h3 style={{ margin: "8px 0 4px" }}>Please fix the following</h3>
                </div>
                <button className="btn secondary" type="button" onClick={() => setErrorDialog(null)}>
                  Close
                </button>
              </div>
              <div className="grid" style={{ gap: 6 }}>
                {errorDialog.map((line, idx) => (
                  <div key={idx} className="tag" style={{ color: "#b03711", background: "rgba(186, 48, 0, 0.08)" }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGate>
  );
}
