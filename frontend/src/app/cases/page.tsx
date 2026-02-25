"use client";

import useSWR from "swr";
import RoleGate from "../../components/RoleGate";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { useMemo, useState } from "react";
import { hasAnyRole } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function CasesPage() {
  const { user } = useAuth();
  const isCadet = hasAnyRole(user, ["Cadet"]);
  const isOfficer = hasAnyRole(user, ["Officer", "Patrol Officer", "Police Officer"]);
  const isDetective = hasAnyRole(user, ["Detective"]);
  const isSergeant = hasAnyRole(user, ["Sergeant"]);
  const isCaptain = hasAnyRole(user, ["Captain"]);
  const isChief = hasAnyRole(user, ["Chief"]);
  const canAddCaseComplainant = hasAnyRole(
    user,
    ["Officer", "Patrol Officer", "Police Officer", "Detective", "Sergeant", "Captain", "Chief"]
  );
  const { data, mutate } = useSWR(user ? endpoints.cases : null, fetcher);
  const { data: evidenceData } = useSWR(user ? endpoints.evidences : null, fetcher);
  const { data: logData } = useSWR(
    user && isDetective ? `${endpoints.activityLogs}?search=evidence` : null,
    fetcher
  );
  const { data: evalData, mutate: refreshEvaluations } = useSWR(
    user ? endpoints.suspectEvaluations : null,
    fetcher
  );
  const isDataLoading =
    !!user &&
    (data === undefined ||
      evidenceData === undefined ||
      evalData === undefined ||
      (isDetective && logData === undefined));
  const cases = data?.results || [];
  const evidences = evidenceData?.results || [];
  const activityLogs = logData?.results || [];
  const evaluations = evalData?.results || [];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [detectiveScoreByEval, setDetectiveScoreByEval] = useState<Record<number, string>>({});
  const [sergeantScoreByEval, setSergeantScoreByEval] = useState<Record<number, string>>({});
  const [detectiveScoreErrByEval, setDetectiveScoreErrByEval] = useState<Record<number, string>>({});
  const [sergeantScoreErrByEval, setSergeantScoreErrByEval] = useState<Record<number, string>>({});
  const [captainNoteByEval, setCaptainNoteByEval] = useState<Record<number, string>>({});
  const [suspectByCase, setSuspectByCase] = useState<Record<number, string>>({});
  const [suspectDateByCase, setSuspectDateByCase] = useState<Record<number, string>>({});
  const [suspectErrByCase, setSuspectErrByCase] = useState<Record<number, string>>({});
  const [suspectOkByCase, setSuspectOkByCase] = useState<Record<number, string>>({});
  const [suspectSavingId, setSuspectSavingId] = useState<number | null>(null);
  const [complainantIdentifierByCase, setComplainantIdentifierByCase] = useState<Record<number, string>>({});
  const [complainantNoteByReview, setComplainantNoteByReview] = useState<Record<number, string>>({});
  const [complainantErrByCase, setComplainantErrByCase] = useState<Record<number, string>>({});
  const [complainantOkByCase, setComplainantOkByCase] = useState<Record<number, string>>({});
  const [complainantBusyKey, setComplainantBusyKey] = useState<string | null>(null);
  const [actionErrById, setActionErrById] = useState<Record<number, string>>({});
  const [captainDecisionById, setCaptainDecisionById] = useState<Record<number, string>>({});
  const [captainNoteById, setCaptainNoteById] = useState<Record<number, string>>({});
  const [chiefDecisionById, setChiefDecisionById] = useState<Record<number, string>>({});
  const [chiefNoteById, setChiefNoteById] = useState<Record<number, string>>({});
  const [sergeantBusyByEval, setSergeantBusyByEval] = useState<Record<number, boolean>>({});
  const scoreRangeMessage = "You must enter a number between 1 and 10.";
  const filtered = useMemo(() => {
    return cases.filter((c: any) => {
      const matchesQuery =
        !query ||
        c.title?.toLowerCase().includes(query.toLowerCase()) ||
        c.number?.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = status === "all" || c.status === status || c.status_label === status;
      return matchesQuery && matchesStatus;
    });
  }, [cases, query, status]);

  const toErrorMessage = (ex: any, fallback: string) => getApiErrorMessage(ex, fallback);
  const validateScoreInput = (value: string, required = false) => {
    const raw = (value || "").trim();
    if (!raw) return required ? scoreRangeMessage : "";
    if (!/^\d+$/.test(raw)) return scoreRangeMessage;
    const num = Number(raw);
    if (num < 1 || num > 10) return scoreRangeMessage;
    return "";
  };

  const approveCase = async (id: number) => {
    await api.post(`${endpoints.cases}${id}/approve/`, { note: noteById[id] || "" });
    mutate();
  };

  const rejectCase = async (id: number) => {
    await api.post(`${endpoints.cases}${id}/reject/`, { note: noteById[id] || "" });
    mutate();
  };

  const detectiveCapture = async (id: number) => {
    try {
      setActionErrById({ ...actionErrById, [id]: "" });
      await api.post(`${endpoints.cases}${id}/detective-capture/`, { note: noteById[id] || "" });
      mutate();
    } catch (ex: any) {
      setActionErrById({
        ...actionErrById,
        [id]: toErrorMessage(ex, "Failed to update case."),
      });
    }
  };

  const submitDetectiveScore = async (evalId: number) => {
    const raw = detectiveScoreByEval[evalId] || "";
    const err = validateScoreInput(raw, true);
    if (err) {
      setDetectiveScoreErrByEval((prev) => ({ ...prev, [evalId]: err }));
      return;
    }
    const score = Number(raw.trim());
    await api.post(`${endpoints.suspectEvaluations}${evalId}/detective-score/`, { score });
    setDetectiveScoreErrByEval((prev) => ({ ...prev, [evalId]: "" }));
    await Promise.all([refreshEvaluations(), mutate()]);
  };

  const submitSergeantScore = async (evalId: number) => {
    const raw = sergeantScoreByEval[evalId] || "";
    const err = validateScoreInput(raw, true);
    if (err) {
      setSergeantScoreErrByEval((prev) => ({ ...prev, [evalId]: err }));
      return;
    }
    const score = Number(raw.trim());
    await api.post(`${endpoints.suspectEvaluations}${evalId}/sergeant-score/`, { score });
    setSergeantScoreErrByEval((prev) => ({ ...prev, [evalId]: "" }));
    await Promise.all([refreshEvaluations(), mutate()]);
  };

  const submitCaptainDecision = async (caseId: number, evalId: number, decision: string) => {
    const notes = (captainNoteByEval[evalId] || "").trim();
    if (!notes) {
      setActionErrById({ ...actionErrById, [evalId]: "Captain notes are required." });
      return;
    }
    const caseEvaluations = evaluationsByCase.get(caseId) || [];
    const willCompleteCaptainCycle =
      caseEvaluations.length > 0 &&
      caseEvaluations.every((ev: any) => !!ev.captain_decision || ev.id === evalId);
    await api.post(`${endpoints.suspectEvaluations}${evalId}/captain-decision/`, { decision, notes });
    setActionErrById({ ...actionErrById, [evalId]: "" });
    await Promise.all([refreshEvaluations(), mutate()]);
    if (willCompleteCaptainCycle && typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const submitSergeantDecision = async (caseId: number, evalId: number, decision: "approve" | "reject") => {
    try {
      setActionErrById((prev) => ({ ...prev, [caseId]: "" }));
      setSergeantBusyByEval((prev) => ({ ...prev, [evalId]: true }));
      await api.post(`${endpoints.suspectEvaluations}${evalId}/sergeant-decision/`, {
        decision,
        notes: noteById[caseId] || "",
      });
      await Promise.all([refreshEvaluations(), mutate()]);
    } catch (ex: any) {
      setActionErrById((prev) => ({
        ...prev,
        [caseId]: toErrorMessage(ex, decision === "reject" ? "Failed to reject suspect." : "Failed to approve suspect."),
      }));
    } finally {
      setSergeantBusyByEval((prev) => ({ ...prev, [evalId]: false }));
    }
  };

  const addCaseComplainant = async (caseId: number) => {
    const identifier = (complainantIdentifierByCase[caseId] || "").trim();
    if (!identifier) {
      setComplainantErrByCase({
        ...complainantErrByCase,
        [caseId]: "Identifier is required (username, email, national ID, or phone number).",
      });
      return;
    }
    try {
      setComplainantBusyKey(`add-${caseId}`);
      setComplainantErrByCase({ ...complainantErrByCase, [caseId]: "" });
      setComplainantOkByCase({ ...complainantOkByCase, [caseId]: "" });
      await api.post(`${endpoints.cases}${caseId}/complainants/`, { identifier });
      setComplainantIdentifierByCase({ ...complainantIdentifierByCase, [caseId]: "" });
      setComplainantOkByCase({ ...complainantOkByCase, [caseId]: "Complainant sent to cadet review." });
      await mutate();
    } catch (ex: any) {
      setComplainantErrByCase({
        ...complainantErrByCase,
        [caseId]: toErrorMessage(ex, "Failed to add complainant."),
      });
    } finally {
      setComplainantBusyKey(null);
    }
  };

  const cadetReviewCaseComplainant = async (caseId: number, reviewId: number, decision: "approve" | "reject") => {
    const note = (complainantNoteByReview[reviewId] || "").trim();
    if (decision === "reject" && !note) {
      setComplainantErrByCase({
        ...complainantErrByCase,
        [caseId]: "Rejection reason is required.",
      });
      return;
    }
    try {
      setComplainantBusyKey(`cadet-${reviewId}`);
      setComplainantErrByCase({ ...complainantErrByCase, [caseId]: "" });
      setComplainantOkByCase({ ...complainantOkByCase, [caseId]: "" });
      await api.post(`${endpoints.cases}${caseId}/complainants/${reviewId}/cadet-review/`, { decision, note });
      setComplainantOkByCase({
        ...complainantOkByCase,
        [caseId]: decision === "approve" ? "Cadet approved and sent to officer." : "Cadet rejected complainant.",
      });
      await mutate();
    } catch (ex: any) {
      setComplainantErrByCase({
        ...complainantErrByCase,
        [caseId]: toErrorMessage(ex, "Failed to submit cadet review."),
      });
    } finally {
      setComplainantBusyKey(null);
    }
  };

  const officerReviewCaseComplainant = async (caseId: number, reviewId: number, decision: "approve" | "reject") => {
    const note = (complainantNoteByReview[reviewId] || "").trim();
    if (decision === "reject" && !note) {
      setComplainantErrByCase({
        ...complainantErrByCase,
        [caseId]: "Rejection reason is required.",
      });
      return;
    }
    try {
      setComplainantBusyKey(`officer-${reviewId}`);
      setComplainantErrByCase({ ...complainantErrByCase, [caseId]: "" });
      setComplainantOkByCase({ ...complainantOkByCase, [caseId]: "" });
      await api.post(`${endpoints.cases}${caseId}/complainants/${reviewId}/officer-review/`, { decision, note });
      setComplainantOkByCase({
        ...complainantOkByCase,
        [caseId]: decision === "approve" ? "Officer approved and complainant added to case." : "Officer rejected and returned to cadet.",
      });
      await mutate();
    } catch (ex: any) {
      setComplainantErrByCase({
        ...complainantErrByCase,
        [caseId]: toErrorMessage(ex, "Failed to submit officer review."),
      });
    } finally {
      setComplainantBusyKey(null);
    }
  };

  const addSuspect = async (caseId: number) => {
    const nationalId = (suspectByCase[caseId] || "").trim();
    const detectedAt = (suspectDateByCase[caseId] || "").trim();
    if (!nationalId) {
      setSuspectErrByCase({ ...suspectErrByCase, [caseId]: "National ID is required." });
      return;
    }
    if (!detectedAt) {
      setSuspectErrByCase({ ...suspectErrByCase, [caseId]: "Detected date is required." });
      return;
    }
    try {
      setSuspectSavingId(caseId);
      setSuspectErrByCase({ ...suspectErrByCase, [caseId]: "" });
      setSuspectOkByCase({ ...suspectOkByCase, [caseId]: "" });
      await api.post(endpoints.suspectEvaluations, {
        case: caseId,
        suspect_national_id: nationalId,
        detected_at: detectedAt,
      });
      setSuspectByCase({ ...suspectByCase, [caseId]: "" });
      setSuspectDateByCase({ ...suspectDateByCase, [caseId]: "" });
      setSuspectOkByCase({ ...suspectOkByCase, [caseId]: "Suspect added." });
      refreshEvaluations();
    } catch (ex: any) {
      setSuspectErrByCase({
        ...suspectErrByCase,
        [caseId]: toErrorMessage(ex, "Failed to add suspect."),
      });
    } finally {
      setSuspectSavingId(null);
    }
  };

  const removeSuspect = async (evalId: number, caseId: number) => {
    try {
      await api.delete(`${endpoints.suspectEvaluations}${evalId}/remove/`);
      refreshEvaluations();
    } catch (ex: any) {
      setSuspectErrByCase({
        ...suspectErrByCase,
        [caseId]: toErrorMessage(ex, "Failed to remove suspect."),
      });
    }
  };

  const evaluationsByCase = useMemo(() => {
    const map = new Map<number, any[]>();
    evaluations.forEach((ev: any) => {
      const list = map.get(ev.case) || [];
      list.push(ev);
      map.set(ev.case, list);
    });
    return map;
  }, [evaluations]);
  const evidenceByCase = useMemo(() => {
    const map = new Map<number, any[]>();
    evidences.forEach((ev: any) => {
      const list = map.get(ev.case) || [];
      list.push(ev);
      map.set(ev.case, list);
    });
    return map;
  }, [evidences]);
  const decisionReadyByCase = useMemo(() => {
    const map = new Map<number, { allDecided: boolean; anyApproved: boolean }>();
    evaluationsByCase.forEach((list, caseId) => {
      const allDecided = list.length > 0 && !list.some((ev) => !ev.sergeant_decision);
      const anyApproved = list.some((ev) => ev.sergeant_decision === "approve");
      map.set(caseId, { allDecided, anyApproved });
    });
    return map;
  }, [evaluationsByCase]);
  const caseLabelById = useMemo(() => {
    const map = new Map<number, string>();
    cases.forEach((c: any) => {
      map.set(c.id, c.title || c.number || "Untitled case");
    });
    return map;
  }, [cases]);

  // case-level captain decision removed; decisions are per suspect

  const submitChiefDecision = async (id: number) => {
    try {
      setActionErrById({ ...actionErrById, [id]: "" });
      const decision = chiefDecisionById[id] || "";
      await api.post(`${endpoints.cases}${id}/chief-decision/`, {
        decision,
        note: chiefNoteById[id] || "",
      });
      await Promise.all([refreshEvaluations(), mutate()]);
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (ex: any) {
      setActionErrById({
        ...actionErrById,
        [id]: toErrorMessage(ex, "Failed to submit chief decision."),
      });
    }
  };
  if (isDataLoading) {
    return (
      <RoleGate roles={["Cadet", "Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief", "Coroner"]}>
        <PageSkeleton title="Loading cases" cards={4} lines={3} />
      </RoleGate>
    );
  }
  return (
    <RoleGate roles={["Cadet", "Officer", "Patrol Officer", "Detective", "Sergeant", "Captain", "Chief", "Coroner"]}>
      <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="section-title">
          <div>
            <div className="pill">Cases</div>
            <h3 style={{ margin: "8px 0 4px" }}>Case registry</h3>
            <p className="muted" style={{ margin: 0 }}>Search by case number or title.</p>
          </div>
        </div>
        <div className="action-row" style={{ marginTop: 12 }}>
          <input
            className="input"
            placeholder="Search cases"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="detective_pending">Detective pending</option>
            <option value="sergeant_pending">Sergeant pending</option>
            <option value="detective_followup">Detective follow-up</option>
            <option value="captain_review">Captain review</option>
            <option value="chief_review">Chief review</option>
            <option value="in_progress">In progress</option>
            <option value="in_trial">In trial</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>
      {isDetective && (
        <div className="card">
          <div className="section-title">
            <div>
              <div className="pill">Notifications</div>
              <h3 style={{ margin: "8px 0 4px" }}>Detective inbox</h3>
              <p className="muted" style={{ margin: 0 }}>
                Live updates for evidence changes that may affect your investigation board.
              </p>
            </div>
          </div>
          <div className="grid" style={{ gap: 8, marginTop: 12 }}>
            {activityLogs.map((log: any) => (
              <div
                key={log.id}
                className="card"
                style={{ margin: 0, borderColor: "rgba(36, 78, 104, 0.28)", background: "rgba(36, 78, 104, 0.06)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span className="tag">
                    {log.action === "create_evidence" ? "New evidence record" : "Evidence attachment update"}
                  </span>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {new Date(log.created_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontWeight: 600 }}>
                  {caseLabelById.get(Number(log.target_id)) || "Unknown case"}
                </div>
                {log.message && <div className="muted" style={{ marginTop: 4 }}>Details: {log.message}</div>}
              </div>
            ))}
            {!activityLogs.length && <div className="empty">No evidence notifications yet.</div>}
          </div>
        </div>
      )}
      <div className="grid" style={{ gap: 12 }}>
        {filtered.map((c: any) => (
          <div key={c.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: "4px 0" }}>{c.title || "Untitled case"}</h3>
                <div className="muted">{c.number ? `Case code: ${c.number}` : "Case code: —"}</div>
              </div>
              <span className="pill">{c.status_label || c.status}</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {c.description}
            </p>
            <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span className="pill">Severity: {c.severity}</span>
              <span className="pill">Source: {c.source}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="muted">Participants</div>
              <ul className="list">
                {(c.participants || []).map((p: any) => (
                  <li key={p.id} className="muted">
                    {p.role}: {p.person?.full_name || "Unknown"}
                  </li>
                ))}
                {!c.participants?.length && <li className="muted">No participants recorded.</li>}
              </ul>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="muted">Complainant onboarding</div>
              {canAddCaseComplainant && (
                <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                  <label className="muted">
                    Identifier (username / email / national ID / phone)
                    <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                  </label>
                  <div className="action-row">
                  <input
                    className="input"
                    placeholder="Identifier: username / email / national ID / phone"
                    value={complainantIdentifierByCase[c.id] || ""}
                    onChange={(e) =>
                      setComplainantIdentifierByCase({
                        ...complainantIdentifierByCase,
                        [c.id]: e.target.value,
                      })
                    }
                  />
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => addCaseComplainant(c.id)}
                    disabled={complainantBusyKey === `add-${c.id}`}
                  >
                    {complainantBusyKey === `add-${c.id}` ? "Adding..." : "Add complainant"}
                  </button>
                  </div>
                </div>
              )}
              {(c.complainant_reviews || []).length ? (
                <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                  {(c.complainant_reviews || []).map((r: any) => {
                    const cadetCanReview =
                      isCadet &&
                      (r.status === "pending" || (r.status === "rejected" && r.officer_status === "rejected"));
                    const officerCanReview = isOfficer && r.status === "approved" && r.officer_status === "pending";
                    let workflowMessage = "";
                    if (r.status === "removed") workflowMessage = "Removed after 3 cadet rejections.";
                    else if (r.status === "approved" && r.officer_status === "approved") workflowMessage = "Approved and added to case.";
                    else if (r.status === "approved" && r.officer_status === "pending") workflowMessage = "Waiting for officer decision.";
                    else if (r.status === "rejected" && r.officer_status === "rejected") workflowMessage = "Officer rejected. Returned to cadet.";
                    else if (r.status === "rejected" && r.officer_status === "pending") workflowMessage = "Cadet rejected. Waiting for next cycle.";
                    else if (r.status === "pending") workflowMessage = "Waiting for cadet review.";
                    return (
                      <div key={r.id} className="card" style={{ margin: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div className="muted">
                            <strong>{r.person?.full_name || "Unknown"}</strong>
                            {r.person?.national_id ? ` • ${r.person.national_id}` : ""}
                            {r.person?.phone_number ? ` • ${r.person.phone_number}` : ""}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <span className="pill">Cadet: {r.status}</span>
                            <span className="pill">Officer: {r.officer_status}</span>
                            <span className="pill">Attempts: {r.cadet_attempts}</span>
                          </div>
                        </div>
                        {(r.rejection_reason || r.officer_rejection_reason) && (
                          <div className="muted" style={{ marginTop: 6 }}>
                            {r.officer_status === "rejected"
                              ? `Officer note: ${r.officer_rejection_reason || "Rejected"}`
                              : `Cadet note: ${r.rejection_reason || "Rejected"}`}
                          </div>
                        )}
                        {!cadetCanReview && !officerCanReview && workflowMessage && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px dashed var(--border)",
                              background: "rgba(36, 78, 104, 0.08)",
                              color: "var(--muted)",
                              fontWeight: 600,
                            }}
                          >
                            {workflowMessage}
                          </div>
                        )}
                        {(cadetCanReview || officerCanReview) && (
                          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                            <textarea
                              className="textarea"
                              placeholder="Review note (required for reject)"
                              value={complainantNoteByReview[r.id] || ""}
                              onChange={(e) =>
                                setComplainantNoteByReview({
                                  ...complainantNoteByReview,
                                  [r.id]: e.target.value,
                                })
                              }
                            />
                            {cadetCanReview && (
                              <div className="action-row">
                                <button
                                  className="btn secondary"
                                  type="button"
                                  onClick={() => cadetReviewCaseComplainant(c.id, r.id, "reject")}
                                  disabled={complainantBusyKey === `cadet-${r.id}`}
                                >
                                  Reject (cadet)
                                </button>
                                <button
                                  className="btn"
                                  type="button"
                                  onClick={() => cadetReviewCaseComplainant(c.id, r.id, "approve")}
                                  disabled={complainantBusyKey === `cadet-${r.id}`}
                                >
                                  Approve (cadet)
                                </button>
                              </div>
                            )}
                            {officerCanReview && (
                              <div className="action-row">
                                <button
                                  className="btn secondary"
                                  type="button"
                                  onClick={() => officerReviewCaseComplainant(c.id, r.id, "reject")}
                                  disabled={complainantBusyKey === `officer-${r.id}`}
                                >
                                  Reject (officer)
                                </button>
                                <button
                                  className="btn"
                                  type="button"
                                  onClick={() => officerReviewCaseComplainant(c.id, r.id, "approve")}
                                  disabled={complainantBusyKey === `officer-${r.id}`}
                                >
                                  Approve (officer)
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 8 }}>
                  No complainants waiting for onboarding.
                </div>
              )}
              {complainantErrByCase[c.id] && (
                <div style={{ color: "var(--danger)", marginTop: 8 }}>{complainantErrByCase[c.id]}</div>
              )}
              {complainantOkByCase[c.id] && (
                <div style={{ color: "var(--success)", marginTop: 8 }}>{complainantOkByCase[c.id]}</div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="muted">Suspects</div>
              {evaluationsByCase.get(c.id)?.length ? (
                <ul className="list">
                  {evaluationsByCase.get(c.id)?.map((ev: any) => (
                    <li key={ev.id} className="muted">
                      {ev.suspect?.full_name || "Unknown"} — Detected: {ev.detected_at || "—"}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="muted">No suspects recorded.</div>
              )}
            </div>
            {isDetective && (c.status === "detective_pending" || c.status_label === "detective_pending") && (
              <div className="grid" style={{ gap: 8, marginTop: 10 }}>
                <textarea
                  placeholder="Status note"
                  className="textarea"
                  value={noteById[c.id] || ""}
                  onChange={(e) => setNoteById({ ...noteById, [c.id]: e.target.value })}
                />
                <div className="action-row">
                  <button
                    className="btn"
                    onClick={() => approveCase(c.id)}
                    disabled={!evaluationsByCase.get(c.id)?.length}
                    title={
                      !evaluationsByCase.get(c.id)?.length
                        ? "Add at least one suspect first."
                        : "Send suspect list to sergeant."
                    }
                  >
                    Send to Sergeant
                  </button>
                </div>
                {!evaluationsByCase.get(c.id)?.length && (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px dashed var(--border)",
                      background: "rgba(196, 99, 45, 0.08)",
                    }}
                    className="muted"
                  >
                    Add at least one suspect before sending to sergeant.
                  </div>
                )}
              </div>
            )}
            {isDetective && (c.status === "detective_pending" || c.status_label === "detective_pending") && (
              <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                <div className="card" style={{ margin: 0 }}>
                  <div className="muted">Add suspect (national ID)</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    Detected date = the date this person was first identified as a suspect in this case.
                  </div>
                  <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                    <label className="muted">
                      National ID
                      <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                    </label>
                    <input
                      className="input"
                      placeholder="National ID"
                      value={suspectByCase[c.id] || ""}
                      onChange={(e) =>
                        setSuspectByCase({ ...suspectByCase, [c.id]: e.target.value })
                      }
                    />
                    <label className="muted">
                      Detected date
                      <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                    </label>
                    <input
                      className="input"
                      type="date"
                      value={suspectDateByCase[c.id] || ""}
                      onChange={(e) =>
                        setSuspectDateByCase({ ...suspectDateByCase, [c.id]: e.target.value })
                      }
                      title="Detected date"
                    />
                    <div className="action-row">
                    <button
                      className="btn secondary"
                      onClick={() => addSuspect(c.id)}
                      disabled={suspectSavingId === c.id}
                    >
                      {suspectSavingId === c.id ? "Adding..." : "Add suspect"}
                    </button>
                    </div>
                  </div>
                  {suspectErrByCase[c.id] && (
                    <div style={{ color: "var(--danger)", marginTop: 6 }}>
                      {suspectErrByCase[c.id]}
                    </div>
                  )}
                  {suspectOkByCase[c.id] && (
                    <div style={{ color: "var(--success)", marginTop: 6 }}>
                      {suspectOkByCase[c.id]}
                    </div>
                  )}
                </div>
                <div className="card" style={{ margin: 0 }}>
                  <div className="muted">Suspects</div>
                  {evaluationsByCase.get(c.id)?.length ? (
                    <ul className="list">
                      {evaluationsByCase.get(c.id)?.map((ev: any) => (
                        <li
                          key={ev.id}
                          className="muted"
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
                        >
                          <span>
                            {ev.suspect?.full_name || "Unknown"} — {ev.status}
                            {ev.detected_at ? ` · Detected: ${ev.detected_at}` : ""}
                          </span>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => removeSuspect(ev.id, c.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="muted" style={{ marginTop: 6 }}>
                      No suspects added yet.
                    </div>
                  )}
                </div>
                {actionErrById[c.id] && (
                  <div style={{ color: "var(--danger)" }}>{actionErrById[c.id]}</div>
                )}
              </div>
            )}
            {isSergeant && c.status === "sergeant_pending" && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="muted">Suspect approvals</div>
                {(evaluationsByCase.get(c.id) || []).length ? (
                  (evaluationsByCase.get(c.id) || []).map((ev: any) => (
                    <div key={ev.id} className="card" style={{ marginTop: 8 }}>
                      <div className="muted">
                        {ev.suspect?.full_name || "Unknown"} — {ev.detected_at ? `Detected: ${ev.detected_at}` : "Detected date missing"}
                      </div>
                      <div className="action-row" style={{ marginTop: 8 }}>
                        {ev.sergeant_decision ? (
                          <span className="tag">Decision: {ev.sergeant_decision}</span>
                        ) : (
                          <>
                            <button
                              className="btn secondary"
                              onClick={() => submitSergeantDecision(c.id, ev.id, "reject")}
                              disabled={!!sergeantBusyByEval[ev.id]}
                            >
                              {sergeantBusyByEval[ev.id] ? "Submitting..." : "Reject"}
                            </button>
                            <button
                              className="btn"
                              onClick={() => submitSergeantDecision(c.id, ev.id, "approve")}
                              disabled={!!sergeantBusyByEval[ev.id]}
                            >
                              {sergeantBusyByEval[ev.id] ? "Submitting..." : "Approve"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted">No suspects submitted for this case.</div>
                )}
                {actionErrById[c.id] && (
                  <div style={{ color: "var(--danger)" }}>{actionErrById[c.id]}</div>
                )}
              </div>
            )}
            {isDetective && c.status === "detective_followup" && (
              <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                <div className="card" style={{ margin: 0 }}>
                  <div className="muted">Suspects</div>
                  {evaluationsByCase.get(c.id)?.length ? (
                    <ul className="list">
                      {evaluationsByCase.get(c.id)?.map((ev: any) => (
                        <li key={ev.id} className="muted">
                          {ev.suspect?.full_name || "Unknown"} — {ev.sergeant_decision || "pending"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="muted" style={{ marginTop: 6 }}>
                      No suspects registered.
                    </div>
                  )}
                </div>
                <div className="action-row">
                  <button
                    className="btn secondary"
                    onClick={() => detectiveCapture(c.id)}
                    disabled={!decisionReadyByCase.get(c.id)?.allDecided || !decisionReadyByCase.get(c.id)?.anyApproved}
                  >
                    Captured suspects
                  </button>
                </div>
                {decisionReadyByCase.get(c.id) && !decisionReadyByCase.get(c.id)?.allDecided && (
                  <div className="muted">Wait for sergeant decisions before capture.</div>
                )}
                {decisionReadyByCase.get(c.id) && decisionReadyByCase.get(c.id)?.allDecided && !decisionReadyByCase.get(c.id)?.anyApproved && (
                  <div className="muted">All suspects were rejected. Add new suspects.</div>
                )}
                {actionErrById[c.id] && (
                  <div style={{ color: "var(--danger)" }}>{actionErrById[c.id]}</div>
                )}
              </div>
            )}
            {(isDetective || isSergeant) && c.status === "in_progress" && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="muted">Suspect evaluations</div>
                  {(evaluationsByCase.get(c.id) || []).map((ev: any) => (
                    <div key={ev.id} className="card" style={{ marginTop: 8 }}>
                      <div className="muted">Suspect: {ev.suspect?.full_name || "Unknown"}</div>
                      <div className="action-row" style={{ marginTop: 8 }}>
                        {isDetective && (
                          <>
                            {ev.detective_score ? (
                              <span className="tag">Detective score: {ev.detective_score}</span>
                            ) : (
                              <>
                                <label className="muted">
                                  Detective score
                                  <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                                </label>
                                <input
                                  className="input"
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="Detective score (1-10)"
                                  value={detectiveScoreByEval[ev.id] || ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setDetectiveScoreByEval({ ...detectiveScoreByEval, [ev.id]: value });
                                    setDetectiveScoreErrByEval((prev) => ({
                                      ...prev,
                                      [ev.id]: validateScoreInput(value, false),
                                    }));
                                  }}
                                  style={
                                    detectiveScoreErrByEval[ev.id]
                                      ? {
                                          borderColor: "var(--danger)",
                                          boxShadow: "0 0 0 1px rgba(210,58,58,0.35)",
                                        }
                                      : undefined
                                  }
                                />
                                <button
                                  className="btn"
                                  onClick={() => submitDetectiveScore(ev.id)}
                                  disabled={
                                    !String(detectiveScoreByEval[ev.id] || "").trim() ||
                                    !!detectiveScoreErrByEval[ev.id]
                                  }
                                  style={
                                    !String(detectiveScoreByEval[ev.id] || "").trim() ||
                                    !!detectiveScoreErrByEval[ev.id]
                                      ? { opacity: 0.45, cursor: "not-allowed" }
                                      : undefined
                                  }
                                >
                                  Submit
                                </button>
                                {!!detectiveScoreErrByEval[ev.id] && (
                                  <div style={{ color: "var(--danger)" }}>{detectiveScoreErrByEval[ev.id]}</div>
                                )}
                              </>
                            )}
                          </>
                        )}
                        {isSergeant && (
                          <>
                            {ev.sergeant_score ? (
                              <span className="tag">Sergeant score: {ev.sergeant_score}</span>
                            ) : (
                              <>
                                <label className="muted">
                                  Sergeant score
                                  <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                                </label>
                                <input
                                  className="input"
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="Sergeant score (1-10)"
                                  value={sergeantScoreByEval[ev.id] || ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setSergeantScoreByEval({ ...sergeantScoreByEval, [ev.id]: value });
                                    setSergeantScoreErrByEval((prev) => ({
                                      ...prev,
                                      [ev.id]: validateScoreInput(value, false),
                                    }));
                                  }}
                                  style={
                                    sergeantScoreErrByEval[ev.id]
                                      ? {
                                          borderColor: "var(--danger)",
                                          boxShadow: "0 0 0 1px rgba(210,58,58,0.35)",
                                        }
                                      : undefined
                                  }
                                />
                                <button
                                  className="btn"
                                  onClick={() => submitSergeantScore(ev.id)}
                                  disabled={
                                    !String(sergeantScoreByEval[ev.id] || "").trim() ||
                                    !!sergeantScoreErrByEval[ev.id]
                                  }
                                  style={
                                    !String(sergeantScoreByEval[ev.id] || "").trim() ||
                                    !!sergeantScoreErrByEval[ev.id]
                                      ? { opacity: 0.45, cursor: "not-allowed" }
                                      : undefined
                                  }
                                >
                                  Submit
                                </button>
                                {!!sergeantScoreErrByEval[ev.id] && (
                                  <div style={{ color: "var(--danger)" }}>{sergeantScoreErrByEval[ev.id]}</div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {!evaluationsByCase.get(c.id)?.length && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      No suspects registered for scoring yet.
                    </div>
                  )}
                </div>
              )}
            {isCaptain && c.status === "captain_review" && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="muted">Captain review</div>
                <div className="grid" style={{ gap: 10, marginTop: 8 }}>
                  <div>
                    <div className="muted">Suspect scores</div>
                    {(evaluationsByCase.get(c.id) || []).length ? (
                      <ul className="list">
                        {(evaluationsByCase.get(c.id) || []).map((ev: any) => (
                          <li key={ev.id} className="muted" style={{ display: "grid", gap: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                              <span>
                                {ev.suspect?.full_name || "Unknown"} — Detective: {ev.detective_score ?? "—"}, Sergeant: {ev.sergeant_score ?? "—"}
                              </span>
                              {ev.captain_decision ? (
                                <span className="tag">Captain: {ev.captain_decision}</span>
                              ) : null}
                            </div>
                            {ev.captain_decision ? (
                              <div className="muted">Captain note: {ev.notes || "—"}</div>
                            ) : (
                              <>
                                <label className="muted">
                                  Captain note
                                  <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                                </label>
                                <textarea
                                  className="textarea"
                                  placeholder="Captain note (required)"
                                  value={captainNoteByEval[ev.id] || ""}
                                  onChange={(e) =>
                                    setCaptainNoteByEval({ ...captainNoteByEval, [ev.id]: e.target.value })
                                  }
                                />
                                <div className="action-row">
                                  <button className="btn" onClick={() => submitCaptainDecision(c.id, ev.id, "guilty")}>
                                    Guilty
                                  </button>
                                  <button className="btn secondary" onClick={() => submitCaptainDecision(c.id, ev.id, "not_guilty")}>
                                    Not guilty
                                  </button>
                                </div>
                                {actionErrById[ev.id] && (
                                  <div style={{ color: "var(--danger)" }}>{actionErrById[ev.id]}</div>
                                )}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted">No suspect scores yet.</div>
                    )}
                  </div>
                  <div>
                    <div className="muted">Evidence</div>
                    {(evidenceByCase.get(c.id) || []).length ? (
                      <ul className="list">
                        {(evidenceByCase.get(c.id) || []).map((ev: any) => (
                          <li key={ev.id} className="muted">
                            {ev.title} — {ev.type}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted">No evidence recorded.</div>
                    )}
                  </div>
                  <div className="muted">
                    After deciding all suspects, the case will move to {c.severity === "critical" ? "chief review" : "trial"} automatically.
                  </div>
                </div>
              </div>
            )}
            {isChief && c.status === "chief_review" && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="muted">Chief review</div>
                <div className="grid" style={{ gap: 10, marginTop: 8 }}>
                  <div>
                    <div className="muted">Captain decision</div>
                    <div>{c.status_note || "—"}</div>
                  </div>
                  <div>
                    <div className="muted">Suspect scores</div>
                    {(evaluationsByCase.get(c.id) || []).length ? (
                      <ul className="list">
                        {(evaluationsByCase.get(c.id) || []).map((ev: any) => (
                          <li key={ev.id} className="muted">
                            {ev.suspect?.full_name || "Unknown"} — Detective: {ev.detective_score ?? "—"}, Sergeant: {ev.sergeant_score ?? "—"}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted">No suspect scores yet.</div>
                    )}
                  </div>
                  <div>
                    <div className="muted">Evidence</div>
                    {(evidenceByCase.get(c.id) || []).length ? (
                      <ul className="list">
                        {(evidenceByCase.get(c.id) || []).map((ev: any) => (
                          <li key={ev.id} className="muted">
                            {ev.title} — {ev.type}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="muted">No evidence recorded.</div>
                    )}
                  </div>
                  <select
                    className="select"
                    value={chiefDecisionById[c.id] || ""}
                    onChange={(e) => setChiefDecisionById({ ...chiefDecisionById, [c.id]: e.target.value })}
                  >
                    <option value="">Select decision</option>
                    <option value="approve">Approve (send to court)</option>
                    <option value="reject">Reject (back to captain)</option>
                  </select>
                  <textarea
                    className="textarea"
                    placeholder="Decision note (optional)"
                    value={chiefNoteById[c.id] || ""}
                    onChange={(e) => setChiefNoteById({ ...chiefNoteById, [c.id]: e.target.value })}
                  />
                  <div className="action-row">
                    <button className="btn" onClick={() => submitChiefDecision(c.id)}>
                      Submit decision
                    </button>
                  </div>
                  {actionErrById[c.id] && (
                    <div style={{ color: "var(--danger)" }}>{actionErrById[c.id]}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {!filtered.length && <div className="empty">No cases match the current filters.</div>}
      </div>
      </div>
    </RoleGate>
  );
}
