"use client";

import useSWR from "swr";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { useState } from "react";
import { hasAnyRole } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function PaymentsPage() {
  const { user } = useAuth();
  const { data, mutate } = useSWR(user ? endpoints.bailPayments : null, fetcher);
  const payments = data?.results || data || [];
  const { data: eligibleData, mutate: refreshEligible } = useSWR(user ? endpoints.bailEligible : null, fetcher);
  const eligible = eligibleData || [];
  const isSergeant = hasAnyRole(user, ["Sergeant"]);
  const { data: casesData, mutate: refreshCases } = useSWR(user && isSergeant ? endpoints.cases : null, fetcher);
  const { data: evalData, mutate: refreshEvaluations } = useSWR(user && isSergeant ? endpoints.suspectEvaluations : null, fetcher);
  const isDataLoading =
    !!user &&
    (data === undefined ||
      eligibleData === undefined ||
      (isSergeant && (casesData === undefined || evalData === undefined)));
  const cases = casesData?.results || [];
  const evaluations = evalData?.results || [];
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bailByCase, setBailByCase] = useState<Record<number, string>>({});
  const [fineByCase, setFineByCase] = useState<Record<number, string>>({});
  const [sergeantBailNoteByEval, setSergeantBailNoteByEval] = useState<Record<number, string>>({});
  const [sergeantBusyEvalId, setSergeantBusyEvalId] = useState<number | null>(null);

  const statusLabel = (status?: string) => {
    if (!status) return "Amount set";
    if (status === "pending") return "Pending payment";
    if (status === "paid") return "Paid";
    if (status === "failed") return "Failed";
    return status;
  };

  const typeLabel = (type?: string) => {
    if (type === "bail") return "Bail";
    if (type === "fine") return "Fine";
    return type || "—";
  };

  const openGateway = async (payment: any) => {
    setErr("");
    try {
      setBusyId(payment.id);
      let url = payment.gateway_url;
      if (!url) {
        const res = await api.post(`${endpoints.bailPayments}${payment.id}/start/`, {
          return_to: window.location.href,
        });
        url = res.data?.payment_url;
      }
      if (!url) {
        setErr("Payment gateway URL not available.");
        return;
      }
      window.location.href = url;
    } catch (ex: any) {
      const err = getApiErrorMessage(ex, "Failed to start payment.");
      setErr(err);
    } finally {
      setBusyId(null);
    }
  };

  const createPayment = async (item: any) => {
    setErr("");
    try {
      const res = await api.post(endpoints.bailPayments, {
        case: item.case_id,
        payment_type: item.payment_type,
        return_to: window.location.href,
      });
      const url = res.data?.payment_url;
      if (url) {
        window.location.href = url;
        return;
      }
      mutate();
      refreshEligible();
    } catch (ex: any) {
      setErr(getApiErrorMessage(ex, "Failed to create payment."));
    }
  };

  const submitSergeantBailDecision = async (evalId: number, decision: "approve" | "reject") => {
    setErr("");
    try {
      if (decision === "reject" && !String(sergeantBailNoteByEval[evalId] || "").trim()) {
        setErr("Rejection note is required.");
        return;
      }
      setSergeantBusyEvalId(evalId);
      await api.post(`${endpoints.suspectEvaluations}${evalId}/sergeant-bail-decision/`, {
        decision,
        note: sergeantBailNoteByEval[evalId] || "",
      });
      await Promise.all([refreshEvaluations(), refreshEligible()]);
    } catch (ex: any) {
      setErr(getApiErrorMessage(ex, "Failed to submit sergeant bail decision."));
    } finally {
      setSergeantBusyEvalId(null);
    }
  };

  if (isDataLoading) {
    return <PageSkeleton title="Loading payments" cards={3} lines={3} />;
  }

  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Please sign in to view and pay your bail or fines.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="pill">Payments</div>
        <h3 style={{ margin: "8px 0 4px" }}>Bail & fine payments</h3>
        <p className="muted" style={{ margin: 0 }}>
          Bail is only for active suspects (level 2/3). Criminals cannot pay bail.
          Fine is for level 3 criminals after court verdict and sergeant pre-fine approval.
        </p>
        <div className="action-row" style={{ marginTop: 10 }}>
          <span className="tag">Step 1: Sergeant sets amount</span>
          <span className="tag">Step 2: Sergeant reviews level 3 criminal pre-fine request</span>
          <span className="tag">Step 3: You pay here</span>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="muted">
            <strong>Currency notice</strong>: Amounts are stored in IRR. Stripe does not support IRR, so charges are
            converted using <strong>100,000 toman = 1 USD</strong> (approx) and a fixed
            <strong> $0.50 processing fee</strong> is added to every payment. Stripe requires a minimum charge, so any
            payment below <strong>$1.00</strong> is rounded up.
          </div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="pill">Help · Test Card</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Use this in Stripe Test mode:
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            <strong>Card</strong>: 4242 4242 4242 4242
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            <strong>Exp</strong>: any future date (e.g. 12/34)
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            <strong>CVC</strong>: any 3 digits (e.g. 123)
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            <strong>ZIP</strong>: 12345 or 00000
          </div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="muted"><strong>Bail</strong>: only for suspects (judge verdict must still be pending).</div>
          <div className="muted" style={{ marginTop: 6 }}><strong>Fine</strong>: only for level 3 criminals after guilty verdict + sergeant pre-fine approval.</div>
        </div>
      </div>

      {err && (
        <div className="card">
          <div style={{ color: "var(--danger)" }}>{err}</div>
        </div>
      )}

      <div className="card">
        <div className="section-title">
          <div>
            <div className="pill">Eligible Payments</div>
            <h3 style={{ margin: "8px 0 4px" }}>Your eligible bail/fine</h3>
            <p className="muted" style={{ margin: 0 }}>
              If you are eligible, create a payment and continue to the gateway. If you see nothing here, the amount is
              not set yet for your case.
            </p>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Type</th>
                <th>Amount</th>
                <th>USD (approx + $0.50 fee)</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {eligible.map((item: any, idx: number) => (
                <tr key={`${item.case_id}-${item.payment_type}-${idx}`}>
                  <td>{`${item.case_title || "Untitled case"}${item.case_number ? ` (${item.case_number})` : ""}`}</td>
                  <td>{typeLabel(item.payment_type)}</td>
                  <td>{Number(item.amount || 0).toLocaleString()}</td>
                  <td className="muted">${Math.max(1, (Number(item.amount || 0)) / 1_000_000 + 0.5).toFixed(2)}</td>
                  <td>
                    <span className="tag">{statusLabel(item.payment_status)}</span>
                  </td>
                  <td>
                    {item.payment_status === "pending" && item.payment_id ? (
                      <button
                        className="btn secondary"
                        onClick={() => openGateway({ id: item.payment_id, gateway_url: "" })}
                      >
                        Pay now
                      </button>
                    ) : item.payment_status === "paid" ? (
                      <span className="muted">Paid</span>
                    ) : (
                      <button className="btn secondary" onClick={() => createPayment(item)}>
                        Create payment
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!eligible.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    No eligible payments found. Ask a sergeant to set the amount for your case.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isSergeant && (
        <>
          <div className="card grid" style={{ gap: 12 }}>
            <div className="section-title">
              <div>
                <div className="pill">Sergeant approval</div>
                <h3 style={{ margin: "8px 0 4px" }}>Level 3 criminal pre-fine decision</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Before setting fine, sergeant must approve/reject bail-payment request for each level 3 criminal.
                </p>
              </div>
            </div>
            <div className="grid" style={{ gap: 10 }}>
              {(evaluations || [])
                .filter((ev: any) => {
                  const caseItem = cases.find((c: any) => c.id === ev.case);
                  return !!caseItem && caseItem.severity === "level_3" && ev.judge_verdict === "guilty";
                })
                .map((ev: any) => {
                  const caseItem = cases.find((c: any) => c.id === ev.case);
                  return (
                    <div key={`sergeant-bail-${ev.id}`} className="card" style={{ margin: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{ev.suspect?.full_name || "Unknown criminal"}</div>
                          <div className="muted">
                            {(caseItem?.title || "Untitled case") + (caseItem?.number ? ` (${caseItem.number})` : "")}
                          </div>
                        </div>
                        <span className="tag">Decision: {ev.captain_bail_decision || "pending"}</span>
                      </div>
                      {ev.captain_bail_note ? (
                        <div className="muted" style={{ marginTop: 8 }}>
                          Note: {ev.captain_bail_note}
                        </div>
                      ) : null}
                      {!ev.captain_bail_decision ? (
                        <div className="grid" style={{ gap: 8, marginTop: 10 }}>
                          <textarea
                            className="textarea"
                            placeholder="Decision note (required for reject)"
                            value={sergeantBailNoteByEval[ev.id] || ""}
                            onChange={(e) =>
                              setSergeantBailNoteByEval({ ...sergeantBailNoteByEval, [ev.id]: e.target.value })
                            }
                          />
                          <div className="action-row">
                            <button
                              className="btn secondary"
                              onClick={() => submitSergeantBailDecision(ev.id, "reject")}
                              disabled={sergeantBusyEvalId === ev.id}
                            >
                              {sergeantBusyEvalId === ev.id ? "Submitting..." : "Reject"}
                            </button>
                            <button
                              className="btn"
                              onClick={() => submitSergeantBailDecision(ev.id, "approve")}
                              disabled={sergeantBusyEvalId === ev.id}
                            >
                              {sergeantBusyEvalId === ev.id ? "Submitting..." : "Approve"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="muted" style={{ marginTop: 8 }}>
                          Sergeant decision is locked.
                        </div>
                      )}
                    </div>
                  );
                })}
              {!((evaluations || []).some((ev: any) => {
                const caseItem = cases.find((c: any) => c.id === ev.case);
                return !!caseItem && caseItem.severity === "level_3" && ev.judge_verdict === "guilty";
              })) && <div className="muted">No level 3 criminal records need sergeant decision.</div>}
            </div>
          </div>

          <div className="card grid" style={{ gap: 12 }}>
            <div className="section-title">
              <div>
                <div className="pill">Sergeant</div>
                <h3 style={{ margin: "8px 0 4px" }}>Set / update amounts per case</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Bail is only for active suspects. Fine is only for level 3 criminals after sergeant pre-fine approval.
                </p>
              </div>
            </div>
            {(() => {
              const relatedByCase = (caseId: number) => evaluations.filter((ev: any) => ev.case === caseId);
              const eligibleBail = cases.filter((caseItem: any) => {
                const related = relatedByCase(caseItem.id);
                const hasApprovedActiveSuspect = related.some(
                  (ev: any) => ev.sergeant_decision === "approve" && !ev.judge_verdict
                );
                return hasApprovedActiveSuspect && ["level_2", "level_3"].includes(caseItem.severity);
              });
              const eligibleFine = cases.filter((caseItem: any) => {
                const related = relatedByCase(caseItem.id);
                const hasGuilty = related.some((ev: any) => ev.judge_verdict === "guilty");
                return hasGuilty && caseItem.severity === "level_3" && caseItem.status === "closed";
              });
              const bailSet = eligibleBail.filter((c: any) => c.bail_amount);
              const bailUnset = eligibleBail.filter((c: any) => !c.bail_amount);
              const fineSet = eligibleFine.filter((c: any) => c.fine_amount);
              const fineUnset = eligibleFine.filter((c: any) => !c.fine_amount);

              const getFineGate = (caseItem: any) => {
                const guiltyEvaluations = relatedByCase(caseItem.id).filter((ev: any) => ev.judge_verdict === "guilty");
                const hasAny = guiltyEvaluations.length > 0;
                const hasPendingDecision = guiltyEvaluations.some((ev: any) => !ev.captain_bail_decision);
                const hasApprovedDecision = guiltyEvaluations.some((ev: any) => ev.captain_bail_decision === "approve");
                const unlocked = hasAny && !hasPendingDecision && hasApprovedDecision;
                let reason = "";
                if (!hasAny) reason = "No guilty criminal exists for this case.";
                else if (hasPendingDecision) reason = "Sergeant must decide all criminal pre-fine requests first.";
                else if (!hasApprovedDecision) reason = "Fine stays disabled because all pre-fine requests were rejected.";
                return { unlocked, reason };
              };

              const renderBailCard = (caseItem: any) => {
                const label = `${caseItem.title || "Untitled case"}${caseItem.number ? ` (${caseItem.number})` : ""} · ${caseItem.severity}`;
                return (
                  <div key={`bail-${caseItem.id}`} className="card" style={{ margin: 0 }}>
                    <div className="muted">{label}</div>
                    <div className="action-row" style={{ marginTop: 10 }}>
                      <input
                        className="input"
                        placeholder="Bail amount"
                        type="number"
                        min={0}
                        value={bailByCase[caseItem.id] ?? caseItem.bail_amount ?? ""}
                        onChange={(e) => setBailByCase({ ...bailByCase, [caseItem.id]: e.target.value })}
                      />
                      <button
                        className="btn secondary"
                        onClick={async () => {
                          try {
                            setErr("");
                            const amount = Number(bailByCase[caseItem.id] ?? caseItem.bail_amount ?? 0);
                            if (!amount || amount <= 0) {
                              setErr("Bail amount must be greater than zero.");
                              return;
                            }
                            await api.post(`${endpoints.cases}${caseItem.id}/set-bail/`, { amount });
                            await refreshCases();
                            await refreshEvaluations();
                            await refreshEligible();
                          } catch (ex: any) {
                            setErr(getApiErrorMessage(ex, "Failed to set bail amount."));
                          }
                        }}
                      >
                        {caseItem.bail_amount ? "Update Bail" : "Set Bail"}
                      </button>
                      {caseItem.bail_amount && (
                        <button
                          className="btn secondary"
                          onClick={async () => {
                            try {
                              setErr("");
                              await api.post(`${endpoints.cases}${caseItem.id}/clear-bail/`);
                              await refreshCases();
                              await refreshEvaluations();
                              await refreshEligible();
                            } catch (ex: any) {
                              setErr(getApiErrorMessage(ex, "Failed to clear bail amount."));
                            }
                          }}
                        >
                          Clear Bail
                        </button>
                      )}
                    </div>
                  </div>
                );
              };

              const renderFineCard = (caseItem: any) => {
                const label = `${caseItem.title || "Untitled case"}${caseItem.number ? ` (${caseItem.number})` : ""} · ${caseItem.severity}`;
                const gate = getFineGate(caseItem);
                return (
                  <div key={`fine-${caseItem.id}`} className="card" style={{ margin: 0 }}>
                    <div className="muted">{label}</div>
                    {!gate.unlocked && gate.reason ? (
                      <div className="muted" style={{ marginTop: 8 }}>
                        {gate.reason}
                      </div>
                    ) : null}
                    <div className="action-row" style={{ marginTop: 10 }}>
                      <input
                        className="input"
                        placeholder="Fine amount"
                        type="number"
                        min={0}
                        value={fineByCase[caseItem.id] ?? caseItem.fine_amount ?? ""}
                        onChange={(e) => setFineByCase({ ...fineByCase, [caseItem.id]: e.target.value })}
                      />
                      <button
                        className="btn secondary"
                        style={!gate.unlocked ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                        disabled={!gate.unlocked}
                        onClick={async () => {
                          try {
                            setErr("");
                            const amount = Number(fineByCase[caseItem.id] ?? caseItem.fine_amount ?? 0);
                            if (!amount || amount <= 0) {
                              setErr("Fine amount must be greater than zero.");
                              return;
                            }
                            await api.post(`${endpoints.cases}${caseItem.id}/set-fine/`, { amount });
                            await refreshCases();
                            await refreshEvaluations();
                            await refreshEligible();
                          } catch (ex: any) {
                            setErr(getApiErrorMessage(ex, "Failed to set fine amount."));
                          }
                        }}
                      >
                        {caseItem.fine_amount ? "Update Fine" : "Set Fine"}
                      </button>
                      {caseItem.fine_amount && (
                        <button
                          className="btn secondary"
                          onClick={async () => {
                            try {
                              setErr("");
                              await api.post(`${endpoints.cases}${caseItem.id}/clear-fine/`);
                              await refreshCases();
                              await refreshEvaluations();
                              await refreshEligible();
                            } catch (ex: any) {
                              setErr(getApiErrorMessage(ex, "Failed to clear fine amount."));
                            }
                          }}
                        >
                          Clear Fine
                        </button>
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <div className="grid" style={{ gap: 16 }}>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">Bail · Not set</div>
                    <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                      {bailUnset.length ? bailUnset.map(renderBailCard) : <div className="muted">No cases.</div>}
                    </div>
                  </div>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">Bail · Set</div>
                    <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                      {bailSet.length ? bailSet.map(renderBailCard) : <div className="muted">No cases.</div>}
                    </div>
                  </div>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">Fine · Not set</div>
                    <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                      {fineUnset.length ? fineUnset.map(renderFineCard) : <div className="muted">No cases.</div>}
                    </div>
                  </div>
                  <div className="card" style={{ margin: 0 }}>
                    <div className="pill">Fine · Set</div>
                    <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                      {fineSet.length ? fineSet.map(renderFineCard) : <div className="muted">No cases.</div>}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}

      <div className="card">
        <div className="section-title">
          <div>
            <div className="pill">Payment History</div>
            <h3 style={{ margin: "8px 0 4px" }}>Your payment records</h3>
            <p className="muted" style={{ margin: 0 }}>
              This list shows payments you have already created.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Type</th>
                <th>Amount</th>
                <th>USD (approx + $0.50 fee)</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(payments || []).map((p: any) => (
                <tr key={p.id}>
                  <td>{p.case}</td>
                  <td>{typeLabel(p.payment_type)}</td>
                  <td>{Number(p.amount || 0).toLocaleString()}</td>
                  <td className="muted">${Math.max(1, (Number(p.amount || 0)) / 1_000_000 + 0.5).toFixed(2)}</td>
                  <td>
                    <span className="tag">{statusLabel(p.status)}</span>
                  </td>
                  <td>
                    {p.status === "pending" ? (
                      <button className="btn secondary" onClick={() => openGateway(p)} disabled={busyId === p.id}>
                        {busyId === p.id ? "Starting…" : "Pay now"}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!payments?.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    No pending payments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
