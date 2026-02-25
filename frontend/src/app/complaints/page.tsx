"use client";

import { FormEvent, useState } from "react";
import useSWR from "swr";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { hasAnyRole } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function ComplaintsPage() {
  const { user } = useAuth();
  const { data, mutate } = useSWR(user ? endpoints.complaints : null, fetcher);
  const { data: caseData, mutate: mutateCases } = useSWR(user ? endpoints.cases : null, fetcher);
  const isDataLoading = !!user && (data === undefined || caseData === undefined);
  const complaints = data?.results || data || [];
  const cases = caseData?.results || caseData || [];
  const myCaseComplainantReviews = (cases || []).flatMap((c: any) =>
    (c.complainant_reviews || [])
      .filter((r: any) => r.is_owner)
      .map((r: any) => ({ caseItem: c, review: r }))
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [editById, setEditById] = useState<Record<number, { title: string; description: string }>>({});
  const [saveErrById, setSaveErrById] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [noteByComplainant, setNoteByComplainant] = useState<Record<number, string>>({});
  const [severityById, setSeverityById] = useState<Record<number, string>>({});
  const [extraById, setExtraById] = useState<Record<number, { identifier: string }>>({});
  const [extraErrById, setExtraErrById] = useState<Record<number, string>>({});
  const [extraSavingId, setExtraSavingId] = useState<number | null>(null);
  const [reviewErrByComplainant, setReviewErrByComplainant] = useState<Record<number, string>>({});
  const [reviewBusyByComplainant, setReviewBusyByComplainant] = useState<Record<number, boolean>>({});
  const [caseResubmitBusyId, setCaseResubmitBusyId] = useState<number | null>(null);
  const [caseResubmitErrById, setCaseResubmitErrById] = useState<Record<number, string>>({});
  const [caseResubmitOkById, setCaseResubmitOkById] = useState<Record<number, string>>({});
  const [caseEditByReviewId, setCaseEditByReviewId] = useState<
    Record<number, { full_name: string; phone_number: string; email: string }>
  >({});

  const isCadet = hasAnyRole(user, ["Cadet"]);
  const isOfficer = hasAnyRole(user, ["Officer", "Patrol Officer"]);
  const canReview = isCadet || isOfficer;
  const displayCadetStatus = (status: string) => (status === "removed" ? "rejected" : status);
  const caseByComplaintId = new Map<number, any>();
  (cases || []).forEach((c: any) => {
    if (c?.complaint) {
      caseByComplaintId.set(Number(c.complaint), c);
    }
  });
  const representedComplaintIds = new Set(
    myCaseComplainantReviews
      .map(({ caseItem }: any) => Number(caseItem?.complaint))
      .filter((id: number) => Number.isFinite(id) && id > 0)
  );
  const myOwnedComplaints = complaints.filter(
    (c: any) => c.is_owner || (c.complainants || []).some((ec: any) => ec.is_owner)
  );
  const standaloneOwnedComplaints = myOwnedComplaints.filter((c: any) => !representedComplaintIds.has(Number(c.id)));
  const simplifyStatus = (isOfficerApproved: boolean, caseStatus?: string, removed?: boolean) => {
    if (removed) return "closed";
    if (!isOfficerApproved) return "registered";
    if (caseStatus === "closed") return "closed";
    return "inprogress";
  };
  const myComplaintStatusItems = [
    ...myCaseComplainantReviews.map(({ caseItem, review }: any) => {
      const isOfficerApproved = review.status === "approved" && review.officer_status === "approved";
      return {
        key: `case-${caseItem.id}-${review.id}`,
        type: "case" as const,
        title: caseItem.title || "Untitled case",
        description: caseItem.description || "",
        caseCode: caseItem.number || "",
        status: simplifyStatus(isOfficerApproved, caseItem.status, review.status === "removed"),
        criminals: caseItem.status === "closed" ? (caseItem.criminals || []) : [],
        updatedAt: review.updated_at || caseItem.updated_at || "",
        canResubmit: review.status === "rejected",
        removed: review.status === "removed",
        caseItem,
        review,
      };
    }),
    ...standaloneOwnedComplaints.map((c: any) => {
      const myComplainant = (c.complainants || []).find((ec: any) => ec.is_owner);
      const linkedCase = caseByComplaintId.get(Number(c.id));
      const isOfficerApproved = myComplainant?.status === "approved" && myComplainant?.officer_status === "approved";
      return {
        key: `complaint-${c.id}`,
        type: "complaint" as const,
        title: c.title || "Untitled complaint",
        description: c.description || "",
        caseCode: linkedCase?.number || "",
        status: simplifyStatus(isOfficerApproved, linkedCase?.status, myComplainant?.status === "removed"),
        criminals: linkedCase?.status === "closed" ? (linkedCase?.criminals || []) : [],
        updatedAt: myComplainant?.updated_at || c.updated_at || "",
        canResubmit: !!myComplainant && myComplainant.status === "rejected",
        removed: myComplainant?.status === "removed",
        complaint: c,
        myComplainant,
      };
    }),
  ].sort((a: any, b: any) => {
    const ad = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bd = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bd - ad;
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post(endpoints.complaints, { title, description });
      setTitle("");
      setDescription("");
      mutate();
    } catch (ex: any) {
      setErr(getApiErrorMessage(ex, "Failed to submit complaint"));
    }
  };


  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Please sign in to submit or review complaints.</p>
      </div>
    );
  }
  if (isDataLoading) {
    return <PageSkeleton title="Loading complaints" cards={3} lines={3} />;
  }
  const startEdit = (c: any) => {
    setEditById({ ...editById, [c.id]: { title: c.title || "", description: c.description || "" } });
    setSaveErrById({ ...saveErrById, [c.id]: "" });
  };

  const cancelEdit = (id: number) => {
    const next = { ...editById };
    delete next[id];
    setEditById(next);
    setSaveErrById({ ...saveErrById, [id]: "" });
  };

  const saveEdit = async (id: number) => {
    const payload = editById[id];
    if (!payload?.title?.trim() || !payload?.description?.trim()) {
      setSaveErrById({ ...saveErrById, [id]: "Title and description are required." });
      return;
    }
    const complaint = complaints.find((item: any) => item.id === id);
    const myComplainantId = complaint?.complainants?.find((ec: any) => ec.is_owner)?.id;
    try {
      setSavingId(id);
      setSaveErrById({ ...saveErrById, [id]: "" });
      await api.patch(`${endpoints.complaints}${id}/`, {
        title: payload.title.trim(),
        description: payload.description.trim(),
        complainant_id: myComplainantId,
      });
      cancelEdit(id);
      mutate();
    } catch (ex: any) {
      setSaveErrById({
        ...saveErrById,
        [id]: getApiErrorMessage(ex, "Failed to update complaint"),
      });
    } finally {
      setSavingId(null);
    }
  };

  const submitCadetReview = async (complaintId: number, complainantId: number, approve: boolean) => {
    const note = noteByComplainant[complainantId] || "";
    if (!approve && !note.trim()) {
      setReviewErrByComplainant({ ...reviewErrByComplainant, [complainantId]: "Rejection reason is required." });
      return;
    }
    try {
      setReviewErrByComplainant({ ...reviewErrByComplainant, [complainantId]: "" });
      setReviewBusyByComplainant({ ...reviewBusyByComplainant, [complainantId]: true });
      await api.post(`${endpoints.complaints}${complaintId}/cadet-review/`, {
        approve,
        note,
        complainant_id: complainantId,
      });
      mutate();
    } catch (ex: any) {
      setReviewErrByComplainant({
        ...reviewErrByComplainant,
        [complainantId]: getApiErrorMessage(ex, "Failed to review complainant."),
      });
    } finally {
      setReviewBusyByComplainant({ ...reviewBusyByComplainant, [complainantId]: false });
    }
  };

  const submitOfficerReview = async (complaintId: number, complainantId: number, accept: boolean) => {
    const payload: any = {
      accept,
      note: noteByComplainant[complainantId] || "",
      complainant_id: complainantId,
    };
    if (accept) {
      payload.severity = severityById[complaintId] || "level_3";
    }
    try {
      setReviewErrByComplainant({ ...reviewErrByComplainant, [complainantId]: "" });
      setReviewBusyByComplainant({ ...reviewBusyByComplainant, [complainantId]: true });
      await api.post(`${endpoints.complaints}${complaintId}/officer-review/`, payload);
      mutate();
    } catch (ex: any) {
      setReviewErrByComplainant({
        ...reviewErrByComplainant,
        [complainantId]: getApiErrorMessage(ex, "Failed to review complainant."),
      });
    } finally {
      setReviewBusyByComplainant({ ...reviewBusyByComplainant, [complainantId]: false });
    }
  };

  const submitExtraComplainant = async (complaintId: number) => {
    const payload = extraById[complaintId];
    if (!payload?.identifier?.trim()) {
      setExtraErrById({
        ...extraErrById,
        [complaintId]: "Identifier (username, email, national ID, or phone number) is required.",
      });
      return;
    }
    try {
      setExtraSavingId(complaintId);
      setExtraErrById({ ...extraErrById, [complaintId]: "" });
      await api.post(`${endpoints.complaints}${complaintId}/complainants/`, {
        identifier: payload.identifier.trim(),
      });
      setExtraById({
        ...extraById,
        [complaintId]: { identifier: "" },
      });
      mutate();
    } catch (ex: any) {
      setExtraErrById({
        ...extraErrById,
        [complaintId]: getApiErrorMessage(ex, "Failed to add complainant"),
      });
    } finally {
      setExtraSavingId(null);
    }
  };

  const startCaseComplainantEdit = (review: any) => {
    setCaseEditByReviewId({
      ...caseEditByReviewId,
      [review.id]: {
        full_name: review.person?.full_name || "",
        phone_number: review.person?.phone_number || "",
        email: review.person?.email || "",
      },
    });
    setCaseResubmitErrById({ ...caseResubmitErrById, [review.id]: "" });
    setCaseResubmitOkById({ ...caseResubmitOkById, [review.id]: "" });
  };

  const cancelCaseComplainantEdit = (reviewId: number) => {
    const next = { ...caseEditByReviewId };
    delete next[reviewId];
    setCaseEditByReviewId(next);
    setCaseResubmitErrById({ ...caseResubmitErrById, [reviewId]: "" });
  };

  const resubmitCaseComplainant = async (
    caseId: number,
    reviewId: number,
    payload: { full_name: string; phone_number: string; email: string }
  ) => {
    if (!payload.full_name.trim()) {
      setCaseResubmitErrById({ ...caseResubmitErrById, [reviewId]: "Full name is required." });
      return;
    }
    try {
      setCaseResubmitBusyId(reviewId);
      setCaseResubmitErrById({ ...caseResubmitErrById, [reviewId]: "" });
      setCaseResubmitOkById({ ...caseResubmitOkById, [reviewId]: "" });
      await api.post(`${endpoints.cases}${caseId}/complainants/${reviewId}/resubmit/`, {
        full_name: payload.full_name.trim(),
        phone_number: payload.phone_number.trim(),
        email: payload.email.trim(),
      });
      await Promise.all([mutate(), mutateCases()]);
      cancelCaseComplainantEdit(reviewId);
      setCaseResubmitOkById({
        ...caseResubmitOkById,
        [reviewId]: "Resubmitted. Waiting for cadet review.",
      });
    } catch (ex: any) {
      setCaseResubmitErrById({
        ...caseResubmitErrById,
        [reviewId]: getApiErrorMessage(ex, "Failed to resubmit."),
      });
    } finally {
      setCaseResubmitBusyId(null);
    }
  };


  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="section-title">
          <div>
            <div className="pill">Complaints</div>
            <h3 style={{ margin: "8px 0 4px" }}>Submit a complaint</h3>
            <p className="muted" style={{ margin: 0 }}>
              Provide a clear title and description. You can add complainants later.
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
        {err && <div style={{ color: "var(--danger)" }}>{err}</div>}
        <button className="btn" type="submit">
          Submit
        </button>
      </form>
      {canReview && (
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="section-title">
              <div>
                <div className="pill">Review queue</div>
                <h3 style={{ margin: "8px 0 4px" }}>Pending complaints</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Cadets review complaint completeness. Officers approve and form cases.
                </p>
              </div>
            </div>
          </div>
          {complaints
            .filter((c: any) => {
              if (isCadet) {
                return (c.complainants || []).some((ec: any) =>
                  ["pending", "rejected"].includes(ec.status)
                );
              }
              if (isOfficer) {
                return (c.complainants || []).some(
                  (ec: any) =>
                    ec.status === "approved" &&
                    ["pending", "rejected"].includes(ec.officer_status || "pending")
                );
              }
              return false;
            })
            .map((c: any) => (
              <div key={`review-${c.id}`} className="card">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div className="muted">Complaint ID: {c.id}</div>
                    <h4 style={{ margin: 0 }}>{c.title}</h4>
                  </div>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>{c.description}</p>
                {isOfficer && (
                  <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                    <div className="muted">Case severity (applied when all complainants are approved)</div>
                    <select
                      className="select"
                      value={severityById[c.id] || "level_3"}
                      onChange={(e) => setSeverityById({ ...severityById, [c.id]: e.target.value })}
                    >
                      <option value="level_3">Level 3</option>
                      <option value="level_2">Level 2</option>
                      <option value="level_1">Level 1</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                )}
                <div className="grid" style={{ gap: 8, marginTop: 10 }}>
                    <div className="muted">Complainants</div>
                  {[
                    ...(c.complainants || []),
                  ].map((ec: any) => (
                    <div key={ec.id} className="card" style={{ marginTop: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div><strong>{ec.person?.full_name || "Unknown"}</strong></div>
                          <div className="muted">Username: {ec.person?.user_username || "—"}</div>
                          <div className="muted">National ID: {ec.person?.national_id || "—"}</div>
                          <div className="muted">Phone: {ec.person?.phone_number || "—"}</div>
                          <div className="muted">Email: {ec.person?.email || "—"}</div>
                        </div>
                        <div className="grid" style={{ gap: 6, justifyItems: "end" }}>
                          <span className="tag">Cadet: {displayCadetStatus(ec.status)}</span>
                          <span className="tag">Officer: {ec.officer_status || "pending"}</span>
                          <span className="tag">Cadet attempts: {ec.cadet_attempts ?? 0}</span>
                        </div>
                      </div>
                      {ec.rejection_reason && (
                        <div className="muted" style={{ marginTop: 6 }}>
                          Cadet note: {ec.rejection_reason}
                        </div>
                      )}
                      {ec.officer_rejection_reason && (
                        <div className="muted" style={{ marginTop: 6 }}>
                          Officer note: {ec.officer_rejection_reason}
                        </div>
                      )}
                      {isCadet && ["pending", "rejected"].includes(ec.status) && (
                        <>
                          {(() => {
                            const cadetCanAct =
                              ec.status === "pending" ||
                              (ec.status === "rejected" && ec.officer_status === "rejected");
                            const cadetLocked = !cadetCanAct;
                            const cadetLockedMessage =
                              ec.status === "rejected"
                                ? "Rejected — waiting for complainant update."
                                : "Decision recorded — waiting for next stage.";
                            return (
                              <>
                                {cadetCanAct ? (
                                  <>
                                    <textarea
                                      placeholder="Cadet review note (required for rejection)"
                                      className="textarea"
                                      value={noteByComplainant[ec.id] || ""}
                                      onChange={(e) =>
                                        setNoteByComplainant({ ...noteByComplainant, [ec.id]: e.target.value })
                                      }
                                    />
                                    <div className="action-row">
                                      <button
                                        className="btn secondary"
                                        onClick={() => submitCadetReview(c.id, ec.id, false)}
                                        disabled={!!reviewBusyByComplainant[ec.id]}
                                      >
                                        {reviewBusyByComplainant[ec.id] ? "Submitting..." : "Reject"}
                                      </button>
                                      <button
                                        className="btn"
                                        onClick={() => submitCadetReview(c.id, ec.id, true)}
                                        disabled={!!reviewBusyByComplainant[ec.id]}
                                      >
                                        {reviewBusyByComplainant[ec.id] ? "Submitting..." : "Approve"}
                                      </button>
                                    </div>
                                  </>
                                ) : (
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
                                    {cadetLockedMessage}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          {reviewErrByComplainant[ec.id] && (
                            <div style={{ color: "var(--danger)", marginTop: 6 }}>
                              {reviewErrByComplainant[ec.id]}
                            </div>
                          )}
                        </>
                      )}
                      {isOfficer && ec.status === "approved" && (
                        <>
                          {(() => {
                            const officerCanAct = ec.officer_status === "pending";
                            return (
                              <>
                                {officerCanAct ? (
                                  <>
                                    <textarea
                                      placeholder="Officer review note (required for return)"
                                      className="textarea"
                                      value={noteByComplainant[ec.id] || ""}
                                      onChange={(e) =>
                                        setNoteByComplainant({ ...noteByComplainant, [ec.id]: e.target.value })
                                      }
                                    />
                                    <div className="action-row">
                                      <button
                                        className="btn secondary"
                                        onClick={() => submitOfficerReview(c.id, ec.id, false)}
                                        disabled={!!reviewBusyByComplainant[ec.id]}
                                      >
                                        {reviewBusyByComplainant[ec.id] ? "Submitting..." : "Return"}
                                      </button>
                                      <button
                                        className="btn"
                                        onClick={() => submitOfficerReview(c.id, ec.id, true)}
                                        disabled={!!reviewBusyByComplainant[ec.id]}
                                      >
                                        {reviewBusyByComplainant[ec.id] ? "Submitting..." : "Accept"}
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <div
                                    style={{
                                      marginTop: 8,
                                      padding: "10px 12px",
                                      borderRadius: 12,
                                      border: "1px dashed var(--border)",
                                      background: "rgba(196, 99, 45, 0.12)",
                                      color: "var(--muted)",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Decision recorded — waiting for cadet review cycle.
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          {reviewErrByComplainant[ec.id] && (
                            <div style={{ color: "var(--danger)", marginTop: 6 }}>
                              {reviewErrByComplainant[ec.id]}
                            </div>
                          )}
                        </>
                      )}
                      {isOfficer && ec.officer_status === "rejected" && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px dashed var(--border)",
                            background: "rgba(196, 99, 45, 0.08)",
                            color: "var(--muted)",
                            fontWeight: 600,
                          }}
                        >
                          Officer rejected — returned to cadet for review.
                        </div>
                      )}
                    </div>
                  ))}
                  {!c.complainants?.length && (
                    <div className="muted">No complainants found.</div>
                  )}
                </div>
                {isCadet && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <h4 style={{ marginTop: 0 }}>Add complainant</h4>
                    <label className="muted">
                      Identifier (username, email, national ID, or phone)
                      <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                    </label>
                    <input
                      className="input"
                      placeholder="Identifier: username, email, national ID, or phone"
                      value={extraById[c.id]?.identifier || ""}
                      onChange={(e) =>
                        setExtraById({
                          ...extraById,
                          [c.id]: { ...extraById[c.id], identifier: e.target.value },
                        })
                      }
                    />
                    <div className="muted" style={{ marginTop: 6 }}>
                      Only one identifier is needed. We will fetch the full profile automatically.
                    </div>
                    {extraErrById[c.id] && <div style={{ color: "var(--danger)" }}>{extraErrById[c.id]}</div>}
                    <div className="action-row">
                      <button
                        className="btn secondary"
                        onClick={() => submitExtraComplainant(c.id)}
                        disabled={extraSavingId === c.id}
                      >
                        {extraSavingId === c.id ? "Submitting..." : "Submit for review"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="grid" style={{ gap: 12 }}>
        <div className="card">
          <div className="section-title">
            <div>
              <div className="pill">My complaints</div>
              <h3 style={{ margin: "8px 0 4px" }}>Complaint status</h3>
              <p className="muted" style={{ margin: 0 }}>
                Status values: registered, inprogress, closed.
              </p>
            </div>
          </div>
        </div>
        {myComplaintStatusItems.map((item: any) => {
          const statusMessage =
            item.removed
              ? "Your complaint request has been closed after rejection."
              : item.status === "closed"
              ? "Your complaint is closed."
              : item.status === "inprogress"
                ? "Your complaint is part of an active case."
                : "Your complaint is registered and under review.";
          return (
            <div key={item.key} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <h4 style={{ margin: 0 }}>{item.title}</h4>
                  {item.caseCode ? <div className="muted">Case code: {item.caseCode}</div> : null}
                </div>
                <span className="tag">Status: {item.status}</span>
              </div>
              {item.description ? (
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  {item.description}
                </p>
              ) : null}
              <div className="muted" style={{ marginTop: 8 }}>{statusMessage}</div>

              {item.status === "closed" && !item.removed && (
                <div style={{ marginTop: 8 }}>
                  <div className="muted">Final criminals in this case</div>
                  {(item.criminals || []).length ? (
                    <ul className="list">
                      {(item.criminals || []).map((criminal: any) => (
                        <li key={`${item.key}-criminal-${criminal.id}`} className="muted">
                          {criminal.full_name || "Unknown"}{criminal.national_id ? ` • ${criminal.national_id}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="muted">No final criminals recorded.</div>
                  )}
                </div>
              )}

              {item.removed && (
                <div style={{ color: "var(--danger)", marginTop: 8, fontWeight: 600 }}>
                  Registration request was rejected.
                </div>
              )}

              {item.type === "case" && item.canResubmit && !item.removed && (
                <div style={{ marginTop: 10 }}>
                  {!caseEditByReviewId[item.review.id] ? (
                    <button
                      className="btn secondary"
                      onClick={() => startCaseComplainantEdit(item.review)}
                      type="button"
                    >
                      Edit & resubmit
                    </button>
                  ) : (
                    <div className="grid" style={{ gap: 8 }}>
                      <label className="muted">
                        Full name
                        <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
                      </label>
                      <input
                        className="input"
                        value={caseEditByReviewId[item.review.id]?.full_name || ""}
                        onChange={(e) =>
                          setCaseEditByReviewId({
                            ...caseEditByReviewId,
                            [item.review.id]: {
                              ...caseEditByReviewId[item.review.id],
                              full_name: e.target.value,
                            },
                          })
                        }
                        placeholder="Full name"
                      />
                      <label className="muted">Phone number</label>
                      <input
                        className="input"
                        value={caseEditByReviewId[item.review.id]?.phone_number || ""}
                        onChange={(e) =>
                          setCaseEditByReviewId({
                            ...caseEditByReviewId,
                            [item.review.id]: {
                              ...caseEditByReviewId[item.review.id],
                              phone_number: e.target.value,
                            },
                          })
                        }
                        placeholder="Phone number"
                      />
                      <label className="muted">Email</label>
                      <input
                        className="input"
                        value={caseEditByReviewId[item.review.id]?.email || ""}
                        onChange={(e) =>
                          setCaseEditByReviewId({
                            ...caseEditByReviewId,
                            [item.review.id]: {
                              ...caseEditByReviewId[item.review.id],
                              email: e.target.value,
                            },
                          })
                        }
                        placeholder="Email"
                        type="email"
                      />
                      <div className="action-row">
                        <button
                          className="btn"
                          type="button"
                          onClick={() =>
                            resubmitCaseComplainant(item.caseItem.id, item.review.id, caseEditByReviewId[item.review.id])
                          }
                          disabled={caseResubmitBusyId === item.review.id}
                        >
                          {caseResubmitBusyId === item.review.id ? "Submitting..." : "Save & resubmit"}
                        </button>
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => cancelCaseComplainantEdit(item.review.id)}
                          disabled={caseResubmitBusyId === item.review.id}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {caseResubmitErrById[item.review.id] && (
                    <div style={{ color: "var(--danger)", marginTop: 8 }}>{caseResubmitErrById[item.review.id]}</div>
                  )}
                  {caseResubmitOkById[item.review.id] && (
                    <div style={{ color: "var(--success)", marginTop: 8 }}>{caseResubmitOkById[item.review.id]}</div>
                  )}
                </div>
              )}

              {item.type === "complaint" && item.canResubmit && !item.removed && (
                <div style={{ marginTop: 10 }}>
                  {!editById[item.complaint.id] ? (
                    <div className="action-row">
                      <button className="btn secondary" onClick={() => startEdit(item.complaint)}>
                        Edit & resubmit
                      </button>
                    </div>
                  ) : (
                    <div className="grid" style={{ gap: 8 }}>
                      <input
                        className="input"
                        value={editById[item.complaint.id]?.title || ""}
                        onChange={(e) =>
                          setEditById({
                            ...editById,
                            [item.complaint.id]: { ...editById[item.complaint.id], title: e.target.value },
                          })
                        }
                        placeholder="Title"
                      />
                      <textarea
                        className="textarea"
                        value={editById[item.complaint.id]?.description || ""}
                        onChange={(e) =>
                          setEditById({
                            ...editById,
                            [item.complaint.id]: { ...editById[item.complaint.id], description: e.target.value },
                          })
                        }
                        placeholder="Description"
                      />
                      {saveErrById[item.complaint.id] && (
                        <div style={{ color: "var(--danger)" }}>{saveErrById[item.complaint.id]}</div>
                      )}
                      <div className="action-row">
                        <button className="btn" onClick={() => saveEdit(item.complaint.id)} disabled={savingId === item.complaint.id}>
                          {savingId === item.complaint.id ? "Saving..." : "Save & resubmit"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!myComplaintStatusItems.length && <div className="empty">No complaints yet.</div>}
      </div>
    </div>
  );
}
