"use client";

import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { hasAnyRole } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const formatErrorMessage = (error: any, fallback: string) => getApiErrorMessage(error, fallback);

export default function TipsPage() {
  const { user } = useAuth();
  const { data, mutate } = useSWR(user ? endpoints.tips : null, fetcher);
  const { data: casesData } = useSWR(user ? endpoints.cases : null, fetcher);
  const isDataLoading = !!user && (data === undefined || casesData === undefined);
  const tips = data?.results || data || [];
  const cases = casesData?.results || [];
  const openCases = useMemo(
    () =>
      cases.filter((c: any) => {
        const status = String(c?.status || "").toLowerCase();
        return status !== "closed" && status !== "rejected";
      }),
    [cases]
  );

  const isOfficer = hasAnyRole(user, ["Officer", "Patrol Officer", "Police Officer"]);
  const isDetective = hasAnyRole(user, ["Detective"]);
  const isSergeantOrAbove = hasAnyRole(user, ["Sergeant", "Captain", "Chief"]);
  const isPolice = hasAnyRole(user, [
    "Cadet",
    "Officer",
    "Patrol Officer",
    "Police Officer",
    "Detective",
    "Sergeant",
    "Captain",
    "Chief",
    "Judge",
    "Coroner",
  ]);
  const isCoroner = hasAnyRole(user, ["Coroner"]);
  const isCitizen = !isPolice && !user?.is_superuser;
  const isCitizenOrCoroner = isCitizen || isCoroner;

  const [form, setForm] = useState({
    caseId: "",
    suspectId: "",
    contactName: "",
    contactPhone: "",
    description: "",
  });
  const [submitErr, setSubmitErr] = useState("");
  const [submitOk, setSubmitOk] = useState("");
  const [reviewNote, setReviewNote] = useState<Record<number, string>>({});
  const [rewardById, setRewardById] = useState<Record<number, string>>({});
  const [detectiveCaseById, setDetectiveCaseById] = useState<Record<number, string>>({});
  const [actionErr, setActionErr] = useState<Record<number, string>>({});
  const [lookup, setLookup] = useState({ nationalId: "", rewardCode: "" });
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupErr, setLookupErr] = useState("");
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);

  const myTips = useMemo(() => {
    if (!user) return [];
    return tips.filter((t: any) => t.submitted_by === user.id || t.submitted_by_details?.id === user.id);
  }, [tips, user]);

  const pendingOfficer = tips.filter((t: any) => t.status === "pending");
  const pendingDetective = tips.filter((t: any) => t.status === "sent_to_detective");
  const approvedTips = tips.filter((t: any) => t.status === "approved");

  if (isDataLoading) {
    return <PageSkeleton title="Loading rewards and tips" cards={3} lines={3} />;
  }

  const submitTip = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitErr("");
    setSubmitOk("");
    if (!form.description.trim()) {
      setSubmitErr("Description is required.");
      return;
    }
    if (!form.caseId && !form.suspectId.trim() && !isCitizenOrCoroner) {
      setSubmitErr("Select a case or provide a suspect national ID.");
      return;
    }
    try {
      await api.post(endpoints.tips, {
        case: form.caseId || null,
        suspect_national_id: form.suspectId.trim(),
        contact_name: form.contactName.trim(),
        contact_phone: form.contactPhone.trim(),
        description: form.description.trim(),
      });
      setForm({ caseId: "", suspectId: "", contactName: "", contactPhone: "", description: "" });
      setSubmitOk("Tip submitted successfully.");
      mutate();
    } catch (ex: any) {
      setSubmitErr(formatErrorMessage(ex, "Failed to submit tip."));
    }
  };

  const officerReview = async (id: number, decision: "reject" | "forward") => {
    try {
      setActionErr({ ...actionErr, [id]: "" });
      await api.post(`${endpoints.tips}${id}/officer-review/`, {
        decision,
        note: reviewNote[id] || "",
      });
      mutate();
    } catch (ex: any) {
      setActionErr({ ...actionErr, [id]: formatErrorMessage(ex, "Failed to review tip.") });
    }
  };

  const detectiveReview = async (id: number, decision: "approve" | "reject", currentCaseId?: number | null) => {
    try {
      setActionErr({ ...actionErr, [id]: "" });
      const rewardAmount = Number(rewardById[id] || 0);
      const selectedCaseId = detectiveCaseById[id] || "";
      const finalCaseId = currentCaseId || (selectedCaseId ? Number(selectedCaseId) : null);
      if (decision === "approve" && rewardAmount <= 0) {
        setActionErr({ ...actionErr, [id]: "Reward amount is required." });
        return;
      }
      if (decision === "approve" && !finalCaseId) {
        setActionErr({ ...actionErr, [id]: "Match this tip to a case before approve." });
        return;
      }
      await api.post(`${endpoints.tips}${id}/detective-review/`, {
        decision,
        reward_amount: rewardAmount,
        case: finalCaseId || undefined,
      });
      mutate();
    } catch (ex: any) {
      setActionErr({ ...actionErr, [id]: formatErrorMessage(ex, "Failed to review tip.") });
    }
  };

  const markRewarded = async (id: number) => {
    try {
      await api.post(`${endpoints.tips}${id}/mark-rewarded/`);
      mutate();
    } catch (ex: any) {
      setErrorDialog({ title: "Reward payout failed", message: formatErrorMessage(ex, "Unable to mark rewarded.") });
    }
  };

  const lookupReward = async (e: FormEvent) => {
    e.preventDefault();
    setLookupErr("");
    setLookupResult(null);
    if (!lookup.nationalId.trim() || !lookup.rewardCode.trim()) {
      setLookupErr("National ID and reward code are required.");
      return;
    }
    try {
      const res = await api.post(`${endpoints.tips}reward-lookup/`, {
        national_id: lookup.nationalId.trim(),
        reward_code: lookup.rewardCode.trim(),
      });
      setLookupResult(res.data);
    } catch (ex: any) {
      setLookupErr(formatErrorMessage(ex, "No reward found for provided credentials."));
    }
  };

  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Sign in to submit tips or check rewards.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {errorDialog && (
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
          onClick={() => setErrorDialog(null)}
        >
          <div className="card" style={{ maxWidth: 520, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div className="section-title">
              <div>
                <div className="pill" style={{ background: "rgba(239, 68, 68, 0.12)", color: "var(--danger)" }}>
                  Error
                </div>
                <h3 style={{ margin: "8px 0 4px" }}>{errorDialog.title}</h3>
              </div>
              <button className="btn secondary" onClick={() => setErrorDialog(null)}>Close</button>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--danger)", fontFamily: "inherit" }}>
              {errorDialog.message}
            </pre>
          </div>
        </div>
      )}

      <div className="card">
        <div className="pill">Tips & Rewards</div>
        <h2 style={{ margin: "8px 0 4px" }}>Submit a tip</h2>
        <p className="muted" style={{ margin: 0 }}>
          Citizens can submit information about a case or a suspect. Officers validate, detectives confirm, and a unique reward
          code is issued for approved tips.
        </p>
      </div>

      <form className="card grid" style={{ gap: 10 }} onSubmit={submitTip}>
        <div className="grid" style={{ gap: 6 }}>
          <label className="muted">Related case (choose if applicable)</label>
          <div className="muted" style={{ fontSize: 13 }}>
            {isCitizenOrCoroner
              ? "For citizens/coroner this is optional. Detective will match your tip to the correct case."
              : "You must select a case or provide the suspect national ID below."}
          </div>
          {isCitizen && (
            <div className="muted" style={{ fontSize: 13 }}>
              Citizen note: you only see and can select cases where you are already a complainant.
            </div>
          )}
          <select
            className="input"
            value={form.caseId}
            onChange={(e) => setForm({ ...form, caseId: e.target.value })}
          >
            <option value="">No case selected</option>
            {openCases.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.title || "Untitled case"}{c.number ? ` (${c.number})` : ""}
              </option>
            ))}
          </select>
        </div>
        <input
          className="input"
          placeholder="Suspect national ID (required if no case selected)"
          value={form.suspectId}
          onChange={(e) => setForm({ ...form, suspectId: e.target.value })}
        />
        <div className="grid grid-2" style={{ gap: 10 }}>
          <input
            className="input"
            placeholder="Contact name (optional)"
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
          />
          <input
            className="input"
            placeholder="Contact phone (optional)"
            value={form.contactPhone}
            onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
          />
        </div>
        <label className="muted">
          Description
          <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
        </label>
        <textarea
          className="textarea"
          placeholder="Describe the information"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        {submitErr && <div style={{ color: "var(--danger)" }}>{submitErr}</div>}
        {submitOk && <div style={{ color: "var(--success)" }}>{submitOk}</div>}
        <button className="btn" type="submit">Submit tip</button>
      </form>

      <div className="grid" style={{ gap: 12 }}>
        <div className="card">
          <div className="pill">My tips</div>
          <h3 style={{ margin: "8px 0 4px" }}>Submitted tips</h3>
          <p className="muted" style={{ margin: 0 }}>Track your submission status and reward codes.</p>
        </div>
        {(!myTips.length && !isPolice) && (
          <div className="card muted">No tips submitted yet.</div>
        )}
        {myTips.map((tip: any) => (
          <div key={tip.id} className="card">
            <div className="action-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="muted">Tip #{tip.id}</div>
                <div style={{ fontWeight: 600 }}>{tip.case_title || "General tip"}</div>
                {tip.case_number && <div className="muted">Case code: {tip.case_number}</div>}
                {tip.suspect_national_id && <div className="muted">Suspect ID: {tip.suspect_national_id}</div>}
              </div>
              <span className="pill">{tip.status}</span>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>{tip.description}</p>
            {tip.reward_code && (
              <div className="action-row" style={{ marginTop: 8 }}>
                <span className="tag">Reward code: {tip.reward_code}</span>
                <span className="tag">Amount: {Number(tip.reward_amount || 0).toLocaleString()} Rials</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {isOfficer && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="pill">Officer review</div>
            <h3 style={{ margin: "8px 0 4px" }}>Pending tips</h3>
            <p className="muted" style={{ margin: 0 }}>Validate incoming tips and forward to detectives.</p>
          </div>
          {!pendingOfficer.length && <div className="card muted">No tips waiting for officer review.</div>}
          {pendingOfficer.map((tip: any) => (
            <div key={tip.id} className="card">
              <div className="action-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>Tip #{tip.id}</strong>
                  <div className="muted">{tip.case_title || "General tip"}</div>
                </div>
                <span className="pill">{tip.status}</span>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>{tip.description}</p>
              <div className="muted" style={{ marginTop: 6 }}>
                Submitted by: {tip.submitted_by_details?.username || "Anonymous"}
              </div>
              <textarea
                className="textarea"
                placeholder="Review note (optional)"
                value={reviewNote[tip.id] || ""}
                onChange={(e) => setReviewNote({ ...reviewNote, [tip.id]: e.target.value })}
              />
              {actionErr[tip.id] && <div style={{ color: "var(--danger)" }}>{actionErr[tip.id]}</div>}
              <div className="action-row" style={{ marginTop: 10 }}>
                <button className="btn secondary" onClick={() => officerReview(tip.id, "reject")}>Reject</button>
                <button className="btn" onClick={() => officerReview(tip.id, "forward")}>Send to detective</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isDetective && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="pill">Detective review</div>
            <h3 style={{ margin: "8px 0 4px" }}>Tips awaiting decision</h3>
            <p className="muted" style={{ margin: 0 }}>
              Approve tips and assign reward amounts. For unassigned tips, match to a case before approval.
            </p>
          </div>
          {!pendingDetective.length && <div className="card muted">No tips waiting for detective review.</div>}
          {pendingDetective.map((tip: any) => (
            <div key={tip.id} className="card">
              <div className="action-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>Tip #{tip.id}</strong>
                  <div className="muted">{tip.case_title || "General tip"}</div>
                </div>
                <span className="pill">{tip.status}</span>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>{tip.description}</p>
              {!tip.case && (
                <div className="grid" style={{ gap: 6, marginTop: 8 }}>
                  <div className="muted">Match to case (required before approve)</div>
                  <select
                  className="input"
                  value={detectiveCaseById[tip.id] || ""}
                  onChange={(e) => setDetectiveCaseById({ ...detectiveCaseById, [tip.id]: e.target.value })}
                >
                  <option value="">Choose case</option>
                  {openCases.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.title || "Untitled case"}{c.number ? ` (${c.number})` : ""}
                    </option>
                  ))}
                </select>
                </div>
              )}
              <input
                className="input"
                placeholder="Reward amount (Rials)"
                value={rewardById[tip.id] || ""}
                onChange={(e) => setRewardById({ ...rewardById, [tip.id]: e.target.value })}
              />
              {actionErr[tip.id] && <div style={{ color: "var(--danger)" }}>{actionErr[tip.id]}</div>}
              <div className="action-row" style={{ marginTop: 10 }}>
                <button className="btn secondary" onClick={() => detectiveReview(tip.id, "reject", tip.case)}>Reject</button>
                <button className="btn" onClick={() => detectiveReview(tip.id, "approve", tip.case)}>Approve + issue code</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isSergeantOrAbove && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="pill">Reward payout</div>
            <h3 style={{ margin: "8px 0 4px" }}>Approved tips</h3>
            <p className="muted" style={{ margin: 0 }}>Mark rewards as paid after verification.</p>
          </div>
          {!approvedTips.length && <div className="card muted">No approved tips waiting for payout.</div>}
          {approvedTips.map((tip: any) => (
            <div key={tip.id} className="card">
              <div className="action-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>Tip #{tip.id}</strong>
                  <div className="muted">Reward code: {tip.reward_code || "—"}</div>
                </div>
                <span className="pill">{tip.status}</span>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Amount: {Number(tip.reward_amount || 0).toLocaleString()} Rials
              </div>
              <button className="btn" style={{ marginTop: 10 }} onClick={() => markRewarded(tip.id)}>
                Mark as paid
              </button>
            </div>
          ))}
        </div>
      )}

      {isPolice && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="pill">Reward lookup</div>
            <h3 style={{ margin: "8px 0 4px" }}>Validate reward code</h3>
            <p className="muted" style={{ margin: 0 }}>
              All police ranks can verify reward payouts using national ID + reward code.
            </p>
          </div>
          <form className="card grid" style={{ gap: 10 }} onSubmit={lookupReward}>
            <input
              className="input"
              placeholder="National ID"
              value={lookup.nationalId}
              onChange={(e) => setLookup({ ...lookup, nationalId: e.target.value })}
            />
            <input
              className="input"
              placeholder="Reward code"
              value={lookup.rewardCode}
              onChange={(e) => setLookup({ ...lookup, rewardCode: e.target.value })}
            />
            {lookupErr && <div style={{ color: "var(--danger)" }}>{lookupErr}</div>}
            <button className="btn" type="submit">Lookup reward</button>
          </form>
          {lookupResult && (
            <div className="card">
              <div className="pill">Reward result</div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>
                Amount: {Number(lookupResult.reward_amount || 0).toLocaleString()} Rials
              </div>
              <div className="muted" style={{ marginTop: 6 }}>Status: {lookupResult.status}</div>
              {lookupResult.submitter && (
                <div className="card" style={{ marginTop: 10 }}>
                  <div className="muted">Submitter</div>
                  <div>{lookupResult.submitter.username}</div>
                  <div className="muted">
                    {lookupResult.submitter.first_name} {lookupResult.submitter.last_name}
                  </div>
                  <div className="muted">National ID: {lookupResult.submitter.national_id}</div>
                  <div className="muted">Phone: {lookupResult.submitter.phone_number}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
