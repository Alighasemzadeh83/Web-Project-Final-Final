"use client";

import useSWR, { useSWRConfig } from "swr";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import RoleGate from "../../components/RoleGate";
import { useAuth } from "../../lib/useAuth";
import { hasAnyRole } from "../../lib/roles";
import { useState } from "react";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function ReportsPage() {
  const { user } = useAuth();
  const allowed = hasAnyRole(user, ["Judge"]);
  const { data: cases } = useSWR(user && allowed ? endpoints.cases : null, fetcher);
  const { data: metrics } = useSWR(user && allowed ? endpoints.metrics : null, fetcher);
  const isDataLoading = !!user && allowed && (cases === undefined || metrics === undefined);

  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Please sign in to access reports.</p>
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Restricted</h3>
        <p className="muted">Reports are available for judges, captains, chiefs, and sergeants.</p>
      </div>
    );
  }
  if (isDataLoading) {
    return (
      <RoleGate roles={["Judge"]}>
        <PageSkeleton title="Loading reports" cards={3} lines={3} />
      </RoleGate>
    );
  }

  return (
    <RoleGate roles={["Judge"]}>
      <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="pill">Reports</div>
        <h3 style={{ margin: "8px 0 4px" }}>Command overview</h3>
        <p className="muted" style={{ margin: 0 }}>
          Review full case reports with participants, evidence, suspects, and verdicts.
        </p>
        <div className="action-row" style={{ marginTop: 10 }}>
          <span className="tag">Total cases: {metrics?.total_cases ?? "—"}</span>
          <span className="tag">Solved: {metrics?.solved_cases ?? "—"}</span>
          <span className="tag">Active: {metrics?.active_cases ?? "—"}</span>
        </div>
      </div>
      <div
        className="grid"
        style={{ gap: 12, maxHeight: "70vh", overflowY: "auto", paddingRight: 6, alignContent: "start" }}
      >
        {(cases?.results || []).map((c: any) => (
          <CaseReportCard key={c.id} caseItem={c} />
        ))}
        {!cases?.results?.length && <div className="empty">No cases available for reporting.</div>}
      </div>
      </div>
    </RoleGate>
  );
}

function CaseReportCard({ caseItem }: { caseItem: any }) {
  const { mutate: mutateGlobal } = useSWRConfig();
  const { user } = useAuth();
  const isJudge = hasAnyRole(user, ["Judge"]);
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [judgeOpen, setJudgeOpen] = useState(false);
  const shouldFetchReport = open || logOpen || judgeOpen;
  const { data: report, mutate: mutateReport } = useSWR(
    shouldFetchReport ? `${endpoints.cases}${caseItem.id}/report/` : null,
    fetcher
  );
  const detail = report?.case || caseItem;
  const evidences = report?.evidences || [];
  const pursuits = report?.pursuits || [];
  const tips = report?.tips || [];
  const evaluations = report?.suspect_evaluations || [];
  const trial = report?.trial;
  const logs = report?.activity_logs || [];
  const decisionLog = report?.decision_log || [];
  const [judgeVerdictByEval, setJudgeVerdictByEval] = useState<Record<number, string>>({});
  const [sentenceTitleByEval, setSentenceTitleByEval] = useState<Record<number, string>>({});
  const [sentenceDescByEval, setSentenceDescByEval] = useState<Record<number, string>>({});
  const [submitErrorByEval, setSubmitErrorByEval] = useState<Record<number, string>>({});
  const [submitAllError, setSubmitAllError] = useState("");
  const [submittingAll, setSubmittingAll] = useState(false);

  const pendingEvaluations = evaluations.filter((ev: any) => !ev.judge_verdict);
  const hasIncompleteJudgeInputs = pendingEvaluations.some((ev: any) => {
    const decision = (judgeVerdictByEval[ev.id] || "").trim();
    const sentenceTitle = (sentenceTitleByEval[ev.id] || "").trim();
    const sentenceDescription = (sentenceDescByEval[ev.id] || "").trim();
    return !decision || !sentenceTitle || !sentenceDescription;
  });

  const submitAllJudgeDecisions = async () => {
    if (!pendingEvaluations.length) {
      setSubmitAllError("All suspects are already judged for this case.");
      return;
    }
    const validationErrors: Record<number, string> = {};
    pendingEvaluations.forEach((ev: any) => {
      const decision = (judgeVerdictByEval[ev.id] || "").trim();
      const sentenceTitle = (sentenceTitleByEval[ev.id] || "").trim();
      const sentenceDescription = (sentenceDescByEval[ev.id] || "").trim();
      if (!decision) {
        validationErrors[ev.id] = "Select guilty or not guilty.";
      } else if (!sentenceTitle || !sentenceDescription) {
        validationErrors[ev.id] = "Punishment title and details are required.";
      }
    });
    if (Object.keys(validationErrors).length) {
      setSubmitErrorByEval((prev) => ({ ...prev, ...validationErrors }));
      setSubmitAllError("Complete all pending suspect decisions before submit.");
      return;
    }
    try {
      setSubmittingAll(true);
      setSubmitAllError("");
      for (const ev of pendingEvaluations) {
        await api.post(`${endpoints.suspectEvaluations}${ev.id}/judge-decision/`, {
          decision: judgeVerdictByEval[ev.id],
          sentence_title: (sentenceTitleByEval[ev.id] || "").trim(),
          sentence_description: (sentenceDescByEval[ev.id] || "").trim(),
        });
      }
      await mutateReport();
      await mutateGlobal(endpoints.cases);
      window.location.reload();
    } catch (err: any) {
      const message = getApiErrorMessage(err, "Failed to submit decision.");
      setSubmitAllError(message);
    } finally {
      setSubmittingAll(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: "4px 0" }}>{detail.title || "Untitled case"}</h3>
          <div className="muted">{detail.number ? `Case code: ${detail.number}` : "Case code: —"}</div>
        </div>
        <span className="pill">{detail.status}</span>
      </div>
      <p className="muted" style={{ margin: "6px 0" }}>
        {detail.description}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span className="pill">Severity: {detail.severity}</span>
        <span className="pill">Source: {detail.source}</span>
        {detail.complaint && <span className="pill">Complaint #{detail.complaint}</span>}
      </div>
      {detail.created_at && (
        <div className="muted" style={{ marginTop: 6 }}>
          Formed at: {new Date(detail.created_at).toLocaleString()}
        </div>
      )}
      <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide details" : "Show details"}
      </button>
      <button
        className="btn secondary"
        style={{ marginTop: 10, marginLeft: 8 }}
        type="button"
        onClick={() => setLogOpen(true)}
      >
        View full log
      </button>
      {isJudge && detail.status === "in_trial" && (
        <button
          className="btn secondary"
          style={{ marginTop: 10, marginLeft: 8 }}
          type="button"
          onClick={() => setJudgeOpen((v) => !v)}
        >
          {judgeOpen ? "Hide judge decisions" : "Show judge decisions"}
        </button>
      )}
      {open && (
        <div className="grid" style={{ gap: 12, marginTop: 12 }}>
          <h4 style={{ margin: 0 }}>Case details</h4>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="card" style={{ margin: 0 }}>
              <div className="pill">Participants</div>
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", paddingRight: 6 }}>
                <ul className="list">
                {(detail.participants || []).map((p: any) => (
                  <li key={p.id} className="muted">
                    {p.role}: {p.person?.full_name || "Unknown"}{" "}
                    {p.person?.user_username ? `(@${p.person.user_username})` : ""}{" "}
                    {p.person?.national_id ? `• ${p.person.national_id}` : ""}
                  </li>
                ))}
                {!detail.participants?.length && (
                  <li className="muted">No participants recorded yet.</li>
                )}
                </ul>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="pill">Evidence</div>
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", paddingRight: 6 }}>
                <ul className="list">
                {(evidences || []).map((ev: any) => (
                  <li key={ev.id} className="muted">
                    {ev.title} ({ev.type}) — {ev.status}
                    {ev.recorded_by_national_id ? ` · by ${ev.recorded_by_national_id}` : ""}
                    {ev.attachments?.length ? ` · attachments: ${ev.attachments.length}` : ""}
                  </li>
                ))}
                {!evidences?.length && <li className="muted">No evidence recorded yet.</li>}
                </ul>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="pill">Pursuits</div>
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", paddingRight: 6 }}>
                <ul className="list">
                {(pursuits || []).map((p: any) => (
                  <li key={p.id} className="muted">
                    {p.suspect?.full_name} — {p.status}
                  </li>
                ))}
                {!pursuits?.length && <li className="muted">No pursuits recorded yet.</li>}
                </ul>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="pill">Tips</div>
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", paddingRight: 6 }}>
                <ul className="list">
                {(tips || []).map((t: any) => (
                  <li key={t.id} className="muted">
                    {t.description?.slice(0, 80)} — {t.status}
                  </li>
                ))}
                {!tips?.length && <li className="muted">No tips recorded yet.</li>}
                </ul>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="pill">Suspect evaluations</div>
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", paddingRight: 6 }}>
                <ul className="list">
                {evaluations.map((ev: any) => (
                  <li key={ev.id} className="muted">
                    {ev.suspect?.full_name || ev.suspect?.national_id} — Detective: {ev.detective_score ?? "—"} ·
                    Sergeant: {ev.sergeant_score ?? "—"} · Captain: {ev.captain_decision || "—"} · Chief:{" "}
                    {ev.chief_decision || "—"} · Judge: {ev.judge_verdict || "—"}
                  </li>
                ))}
                {!evaluations.length && <li className="muted">No evaluations recorded yet.</li>}
                </ul>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="pill">Trial</div>
              {evaluations.length ? (
                <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto", paddingRight: 6 }} className="grid">
                  {evaluations.map((ev: any) => (
                    <div key={ev.id} className="muted">
                      {ev.suspect?.full_name || ev.suspect?.national_id}: {ev.judge_verdict || "Pending"} —{" "}
                      {ev.sentence_title || "—"}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 8 }}>
                  No trial verdict recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {judgeOpen && isJudge && detail.status === "in_trial" && (
        <div className="card grid" style={{ gap: 12, marginTop: 12, maxHeight: 420, overflowY: "auto", paddingRight: 6 }}>
          <h4 style={{ margin: 0 }}>Judge decisions</h4>
          {(evaluations || []).length ? (
            evaluations.map((ev: any) => (
              <div key={ev.id} className="card" style={{ margin: 0 }}>
                <div className="muted">
                  {ev.suspect?.full_name || ev.suspect?.national_id} — Detective: {ev.detective_score ?? "—"} ·
                  Sergeant: {ev.sergeant_score ?? "—"} · Captain: {ev.captain_decision || "—"}
                </div>
                {ev.judge_verdict ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    Verdict: {ev.judge_verdict} · Punishment: {ev.sentence_title} — {ev.sentence_description}
                  </div>
                ) : (
                  <>
                    <label className="muted">
                      Verdict
                      <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                    </label>
                    <select
                      className="select"
                      value={judgeVerdictByEval[ev.id] || ""}
                      onChange={(e) => {
                        setJudgeVerdictByEval({ ...judgeVerdictByEval, [ev.id]: e.target.value });
                        setSubmitErrorByEval({ ...submitErrorByEval, [ev.id]: "" });
                        setSubmitAllError("");
                      }}
                    >
                      <option value="">Select verdict</option>
                      <option value="guilty">Guilty</option>
                      <option value="not_guilty">Not guilty</option>
                    </select>
                    <label className="muted">
                      Punishment title
                      <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                    </label>
                    <input
                      className="input"
                      placeholder="Punishment title"
                      value={sentenceTitleByEval[ev.id] || ""}
                      onChange={(e) => {
                        setSentenceTitleByEval({ ...sentenceTitleByEval, [ev.id]: e.target.value });
                        setSubmitErrorByEval({ ...submitErrorByEval, [ev.id]: "" });
                        setSubmitAllError("");
                      }}
                    />
                    <label className="muted">
                      Punishment details
                      <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                    </label>
                    <textarea
                      className="textarea"
                      placeholder="Punishment details"
                      value={sentenceDescByEval[ev.id] || ""}
                      onChange={(e) => {
                        setSentenceDescByEval({ ...sentenceDescByEval, [ev.id]: e.target.value });
                        setSubmitErrorByEval({ ...submitErrorByEval, [ev.id]: "" });
                        setSubmitAllError("");
                      }}
                    />
                    {submitErrorByEval[ev.id] && (
                      <div className="muted" style={{ color: "var(--danger)" }}>
                        {submitErrorByEval[ev.id]}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          ) : (
            <div className="muted">No suspects available for judgment.</div>
          )}
          {!!pendingEvaluations.length && (
            <>
              <button
                className="btn"
                type="button"
                onClick={submitAllJudgeDecisions}
                disabled={submittingAll || hasIncompleteJudgeInputs}
                style={submittingAll || hasIncompleteJudgeInputs ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
              >
                {submittingAll ? "Submitting all..." : "Submit all decisions"}
              </button>
              {hasIncompleteJudgeInputs && (
                <div className="muted" style={{ color: "var(--danger)" }}>
                  You must complete all pending suspect verdict fields before submit.
                </div>
              )}
            </>
          )}
          {!pendingEvaluations.length && (
            <div className="muted">All suspect decisions are already submitted for this case.</div>
          )}
          {submitAllError && (
            <div className="muted" style={{ color: "var(--danger)" }}>
              {submitAllError}
            </div>
          )}
        </div>
      )}
      {logOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 10, 6, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            padding: 24,
          }}
        >
          <div className="card" style={{ maxWidth: 820, width: "100%", maxHeight: "80vh", overflow: "hidden" }}>
            <div className="section-title">
              <div>
                <div className="pill">Process log</div>
                <h3 style={{ margin: "8px 0 4px" }}>Case activity trail</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Full approval/rejection timeline with actor details.
                </p>
              </div>
              <button className="btn secondary" type="button" onClick={() => setLogOpen(false)}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 12, maxHeight: "60vh", overflowY: "auto" }}>
              {!report && <div className="muted">Loading case log…</div>}
              {report && (
                <div className="grid" style={{ gap: 12, marginBottom: 14 }}>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">Case snapshot</div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      Title: {detail.title || "Untitled case"}
                    </div>
                    <div className="muted">Case code: {detail.number || "—"}</div>
                    <div className="muted">Status: {detail.status || "—"}</div>
                    <div className="muted">Severity: {detail.severity || "—"}</div>
                    <div className="muted">Source: {detail.source || "—"}</div>
                  </div>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">All participants</div>
                    <ul className="list" style={{ marginTop: 8 }}>
                      {(detail.participants || []).map((p: any) => (
                        <li key={`full-log-participant-${p.id}`} className="muted">
                          {p.role}: {p.person?.full_name || "Unknown"}
                          {p.person?.national_id ? ` • ${p.person.national_id}` : ""}
                          {p.person?.phone_number ? ` • ${p.person.phone_number}` : ""}
                          {p.person?.email ? ` • ${p.person.email}` : ""}
                        </li>
                      ))}
                      {!detail.participants?.length && <li className="muted">No participants recorded.</li>}
                    </ul>
                  </div>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">Evidence & records</div>
                    <ul className="list" style={{ marginTop: 8 }}>
                      {(evidences || []).map((ev: any) => (
                        <li key={`full-log-evidence-${ev.id}`} className="muted">
                          {ev.title} ({ev.type}) — {ev.status}
                          {ev.recorded_by_national_id ? ` • Recorder: ${ev.recorded_by_national_id}` : ""}
                          {ev.status_note ? ` • Note: ${ev.status_note}` : ""}
                        </li>
                      ))}
                      {!evidences?.length && <li className="muted">No evidence recorded.</li>}
                    </ul>
                  </div>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">Suspect decisions</div>
                    <ul className="list" style={{ marginTop: 8 }}>
                      {(evaluations || []).map((ev: any) => (
                        <li key={`full-log-eval-${ev.id}`} className="muted">
                          {ev.suspect?.full_name || "Unknown"}
                          {ev.suspect?.national_id ? ` • ${ev.suspect.national_id}` : ""}
                          {` • Detective: ${ev.detective_score ?? "—"}`}
                          {` • Sergeant: ${ev.sergeant_score ?? "—"}`}
                          {` • Sergeant decision: ${ev.sergeant_decision || "—"}`}
                          {` • Captain: ${ev.captain_decision || "—"}`}
                          {` • Chief: ${ev.chief_decision || "—"}`}
                          {` • Judge: ${ev.judge_verdict || "—"}`}
                          {ev.sentence_title ? ` • Sentence: ${ev.sentence_title}` : ""}
                          {ev.sentence_description ? ` — ${ev.sentence_description}` : ""}
                        </li>
                      ))}
                      {!evaluations?.length && <li className="muted">No suspect evaluations recorded.</li>}
                    </ul>
                  </div>
                </div>
              )}
              <ul className="list">
                {logs.map((log: any) => (
                  <li key={log.id} className="muted">
                    [{new Date(log.created_at).toLocaleString()}] {log.action} —{" "}
                    {log.actor_username || "system"}{" "}
                    {log.actor_roles?.length ? `(${log.actor_roles.join(", ")})` : ""}{" "}
                    {log.message ? `• ${log.message}` : ""}
                  </li>
                ))}
                {!logs.length && <li className="muted">No activity recorded.</li>}
              </ul>
              <div className="section-title" style={{ marginTop: 16 }}>
                <div>
                  <div className="pill">Decisions & reports</div>
                  <p className="muted" style={{ margin: 0 }}>
                    Formal approvals/rejections and verdict notes.
                  </p>
                </div>
              </div>
              <ul className="list" style={{ marginTop: 8 }}>
                {decisionLog.map((entry: any, idx: number) => (
                  <li key={`${entry.title}-${idx}`} className="muted">
                    [{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—"}] {entry.title}
                    {entry.actor ? ` — ${entry.actor}` : ""} {entry.details ? `• ${entry.details}` : " • —"}
                  </li>
                ))}
                {!decisionLog.length && <li className="muted">No decision reports recorded.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
