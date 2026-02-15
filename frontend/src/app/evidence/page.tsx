"use client";

import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { hasRole } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const formatErrorMessage = (error: any) => getApiErrorMessage(error, "Request failed.");

export default function EvidencePage() {
  const { user } = useAuth();
  const isCoroner = hasRole(user, ["Coroner"]);
  const isDetective = hasRole(user, ["Detective"]);
  const isPoliceOrCoroner =
    !!user?.is_superuser ||
    hasRole(user, [
      "Administrator",
      "Officer",
      "Patrol Officer",
      "Police Officer",
      "Detective",
      "Sergeant",
      "Captain",
      "Chief",
      "Cadet",
      "Coroner",
    ]);
  const isCitizenMode = !!user && !isPoliceOrCoroner;
  const shouldLoadCases = !!user && !isCitizenMode;
  const { data: casesData } = useSWR(shouldLoadCases ? endpoints.cases : null, fetcher);
  const { data, mutate } = useSWR(user ? endpoints.evidences ?? "/evidences/" : null, fetcher);
  const isDataLoading = !!user && (data === undefined || (shouldLoadCases && casesData === undefined));
  const evidences = data?.results || [];
  const cases = useMemo(() => casesData?.results || [], [casesData]);
  const openCases = useMemo(
    () =>
      cases.filter((c: any) => {
        const status = String(c?.status || "").toLowerCase();
        return status !== "closed" && status !== "rejected";
      }),
    [cases]
  );
  const [payload, setPayload] = useState({
    case: "",
    type: "generic",
    title: "",
    description: "",
    recorded_at: "",
    vehicle_model: "",
    vehicle_color: "",
    plate_number: "",
    serial_number: "",
    owner_name: "",
    transcript: "",
    forensic_result: "",
  });
  const [docFields, setDocFields] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [attachId, setAttachId] = useState("");
  const [attachDesc, setAttachDesc] = useState("");
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  const [assignCaseByEvidence, setAssignCaseByEvidence] = useState<Record<number, string>>({});
  const [assignBusyId, setAssignBusyId] = useState<number | null>(null);
  const [newEvidenceFiles, setNewEvidenceFiles] = useState<File[]>([]);
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [evidencePickerOpen, setEvidencePickerOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);
  const isPoliceSubmitter = (roles: string[] = []) => {
    const normalized = roles.map((r) => String(r).toLowerCase());
    return [
      "administrator",
      "officer",
      "patrol officer",
      "police officer",
      "detective",
      "sergeant",
      "captain",
      "chief",
      "cadet",
      "coroner",
      "superuser",
    ].some((role) => normalized.includes(role));
  };
  const selectedCase = useMemo(
    () => cases.find((c: any) => String(c.id) === String(payload.case)),
    [cases, payload.case]
  );

  if (isDataLoading) {
    return <PageSkeleton title="Loading evidence workspace" cards={3} lines={3} />;
  }

  const submitEvidence = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!isCitizenMode && !payload.case) {
        setErrorDialog({ title: "Missing case", message: "Please choose a case first." });
        return;
      }
      if (!payload.recorded_at) {
        setErrorDialog({ title: "Missing recorded date", message: "Please provide the evidence recorded date." });
        return;
      }
      if (isCitizenMode && payload.type === "forensic") {
        setErrorDialog({
          title: "Forensic restricted",
          message: "Citizen submissions cannot be forensic. Submit it as generic evidence for detective assignment.",
        });
        return;
      }
      if (payload.type === "vehicle") {
        const hasPlate = !!payload.plate_number.trim();
        const hasSerial = !!payload.serial_number.trim();
        if (hasPlate === hasSerial) {
          setErrorDialog({
            title: "Vehicle info required",
            message: "Provide exactly one of plate number or serial number for vehicle evidence.",
          });
          return;
        }
      }
      if (payload.type === "forensic" && !newEvidenceFiles.length) {
        setErrorDialog({
          title: "Attachment required",
          message: "Forensic evidence must include at least one attachment before submission.",
        });
        return;
      }
      const recordedAt = payload.recorded_at ? new Date(payload.recorded_at).toISOString() : undefined;
      let extra_data: Record<string, any> = {};
      if (payload.type === "vehicle") {
        extra_data = {
          model: payload.vehicle_model,
          color: payload.vehicle_color,
          plate_number: payload.plate_number || undefined,
          serial_number: payload.serial_number || undefined,
        };
      } else if (payload.type === "id_document") {
        const fields: Record<string, string> = {};
        docFields.forEach((field) => {
          if (field.key.trim()) {
            fields[field.key.trim()] = field.value.trim();
          }
        });
        extra_data = {
          owner_name: payload.owner_name,
          fields,
        };
      } else if (payload.type === "testimony") {
        extra_data = {
          transcript: payload.transcript,
        };
      } else if (payload.type === "forensic") {
        extra_data = {
          forensic_result: payload.forensic_result || "",
        };
      }
      const form = new FormData();
      if (payload.case) {
        form.append("case", String(payload.case));
      }
      form.append("type", payload.type);
      form.append("title", payload.title);
      form.append("description", payload.description);
      if (recordedAt) form.append("recorded_at", recordedAt);
      form.append("extra_data", JSON.stringify(extra_data));
      newEvidenceFiles.forEach((file) => form.append("files", file));
      await api.post(endpoints.evidences, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPayload({
        case: "",
        type: "generic",
        title: "",
        description: "",
        recorded_at: "",
        vehicle_model: "",
        vehicle_color: "",
        plate_number: "",
        serial_number: "",
        owner_name: "",
        transcript: "",
        forensic_result: "",
      });
      setDocFields([{ key: "", value: "" }]);
      setNewEvidenceFiles([]);
      mutate();
    } catch (ex: any) {
      setErrorDialog({ title: "Evidence submission failed", message: formatErrorMessage(ex) });
    }
  };

  const assignCitizenEvidence = async (evidenceId: number) => {
    const caseId = assignCaseByEvidence[evidenceId];
    if (!caseId) {
      setErrorDialog({ title: "Case required", message: "Choose a case before assigning evidence." });
      return;
    }
    try {
      setAssignBusyId(evidenceId);
      await api.post(`${endpoints.evidences}${evidenceId}/assign-case/`, { case: Number(caseId) });
      setAssignCaseByEvidence((prev) => ({ ...prev, [evidenceId]: "" }));
      mutate();
    } catch (ex: any) {
      setErrorDialog({ title: "Assign failed", message: formatErrorMessage(ex) });
    } finally {
      setAssignBusyId(null);
    }
  };

  const reviewEvidence = async (id: number, decision: "approve" | "reject") => {
    try {
      await api.post(`${endpoints.evidences}${id}/review/`, { decision });
      mutate();
    } catch (ex: any) {
      setErrorDialog({ title: "Review failed", message: formatErrorMessage(ex) });
    }
  };

  const uploadAttachment = async (e: FormEvent) => {
    e.preventDefault();
    if (!attachId || !attachFiles.length) {
      setErrorDialog({ title: "Missing attachment", message: "Please choose an evidence item and file first." });
      return;
    }
    try {
      for (const file of attachFiles) {
        const form = new FormData();
        form.append("file", file);
        if (attachDesc) form.append("description", attachDesc);
        await api.post(`${endpoints.evidences}${attachId}/attachments/`, form);
      }
      setAttachId("");
      setAttachDesc("");
      setAttachFiles([]);
      mutate();
    } catch (ex: any) {
      setErrorDialog({ title: "Upload failed", message: formatErrorMessage(ex) });
    }
  };

  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Please sign in to register or review evidence.</p>
      </div>
    );
  }

  return (
      <div className="grid" style={{ gap: 16 }}>
        <div className="card">
        <div className="pill">Evidence</div>
        <h3 style={{ margin: "8px 0 4px" }}>Register and review evidence</h3>
        <p className="muted" style={{ margin: 0 }}>
          All evidence must include title, description, and recorded date. Vehicle evidence needs model, color, and plate
          or serial. Testimony requires a transcript. Forensic evidence needs attachments. Coroner can review only pending
          forensic evidence. Citizens can submit evidence without case assignment; detective will assign those records later.
        </p>
      </div>
      <form className="card grid" style={{ gap: 10 }} onSubmit={submitEvidence}>
        <h3 style={{ margin: 0 }}>Register evidence</h3>
          {isCitizenMode ? (
            <div className="card" style={{ margin: 0 }}>
              <div className="muted">
                Citizen mode: submit your evidence now. A detective will assign it to the matching case.
              </div>
            </div>
          ) : (
            <div className="grid" style={{ gap: 8 }}>
              <div className="muted">Selected case</div>
              {payload.case ? (
                <div
                  className="card"
                  style={{ margin: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <div>
                    <div><strong>{selectedCase?.title || "Untitled case"}</strong></div>
                    <div className="muted">{selectedCase?.number ? `Case code: ${selectedCase.number}` : "Case code: —"}</div>
                  </div>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setPayload({ ...payload, case: "" })}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="muted">No case selected</div>
              )}
              <button className="btn secondary" type="button" onClick={() => setCasePickerOpen(true)}>
                Choose case
              </button>
            </div>
          )}
          <select
            value={payload.type}
            onChange={(e) => setPayload({ ...payload, type: e.target.value })}
            className="select"
          >
            <option value="generic">Generic</option>
            <option value="testimony">Testimony</option>
            {!isCitizenMode && <option value="forensic">Forensic</option>}
            <option value="vehicle">Vehicle</option>
            <option value="id_document">ID Document</option>
          </select>
          <label className="muted">
            Recorded at
            <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
          </label>
          <input
            type="datetime-local"
            value={payload.recorded_at}
            onChange={(e) => setPayload({ ...payload, recorded_at: e.target.value })}
            required
            className="input"
          />
          <label className="muted">
            Title
            <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
          </label>
          <input
            placeholder="Title"
            value={payload.title}
            onChange={(e) => setPayload({ ...payload, title: e.target.value })}
            required
            className="input"
          />
          <textarea
            placeholder="Description"
            value={payload.description}
            onChange={(e) => setPayload({ ...payload, description: e.target.value })}
            className="textarea"
          />
          {payload.type === "vehicle" && (
            <div className="grid" style={{ gap: 8 }}>
              <div className="grid grid-2">
                <input
                  placeholder="Vehicle model"
                  value={payload.vehicle_model}
                  onChange={(e) => setPayload({ ...payload, vehicle_model: e.target.value })}
                  className="input"
                />
                <input
                  placeholder="Vehicle color"
                  value={payload.vehicle_color}
                  onChange={(e) => setPayload({ ...payload, vehicle_color: e.target.value })}
                  className="input"
                />
              </div>
              <div className="grid grid-2">
                <input
                  placeholder="Plate number (optional if serial provided)"
                  value={payload.plate_number}
                  onChange={(e) => setPayload({ ...payload, plate_number: e.target.value })}
                  className="input"
                />
                <input
                  placeholder="Serial number (optional if plate provided)"
                  value={payload.serial_number}
                  onChange={(e) => setPayload({ ...payload, serial_number: e.target.value })}
                  className="input"
                />
              </div>
            </div>
          )}
          {payload.type === "id_document" && (
            <div className="grid" style={{ gap: 8 }}>
              <input
                placeholder="Owner full name"
                value={payload.owner_name}
                onChange={(e) => setPayload({ ...payload, owner_name: e.target.value })}
                className="input"
              />
              <div className="muted">Additional fields (key/value)</div>
              <div style={{ maxHeight: 200, overflowY: "auto", display: "grid", gap: 8 }}>
                {docFields.map((field, index) => (
                  <div key={`${field.key}-${index}`} className="grid grid-2" style={{ alignItems: "center" }}>
                    <input
                      placeholder="Key"
                      value={field.key}
                      onChange={(e) =>
                        setDocFields((prev) =>
                          prev.map((item, idx) => (idx === index ? { ...item, key: e.target.value } : item))
                        )
                      }
                      className="input"
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        placeholder="Value"
                        value={field.value}
                        onChange={(e) =>
                          setDocFields((prev) =>
                            prev.map((item, idx) => (idx === index ? { ...item, value: e.target.value } : item))
                          )
                        }
                        className="input"
                      />
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setDocFields((prev) => prev.filter((_, idx) => idx !== index))}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setDocFields((prev) => [...prev, { key: "", value: "" }])}
              >
                Add key/value
              </button>
            </div>
          )}
          {payload.type === "testimony" && (
            <textarea
              placeholder="Witness transcript"
              value={payload.transcript}
              onChange={(e) => setPayload({ ...payload, transcript: e.target.value })}
              className="textarea"
            />
          )}
          {payload.type === "forensic" && (
            <textarea
              placeholder="Forensic follow-up (optional)"
              value={payload.forensic_result}
              onChange={(e) => setPayload({ ...payload, forensic_result: e.target.value })}
              className="textarea"
            />
          )}
          <div className="grid" style={{ gap: 6 }}>
            <label className="muted">Attachments (optional)</label>
            <input
              type="file"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (!files.length) return;
                setNewEvidenceFiles((prev) => [...prev, ...files]);
                e.currentTarget.value = "";
              }}
              className="input"
            />
            {newEvidenceFiles.length > 0 && (
              <div className="card" style={{ margin: 0 }}>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Selected files
                </div>
                <div style={{ display: "grid", gap: 6, maxHeight: 160, overflowY: "auto" }}>
                  {newEvidenceFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span className="muted">{file.name}</span>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() =>
                          setNewEvidenceFiles((prev) => prev.filter((_, idx) => idx !== index))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {payload.type === "forensic" && !newEvidenceFiles.length && (
              <div className="muted">
                Forensic evidence must include at least one attachment before approval.
              </div>
            )}
          </div>
          <button className="btn" type="submit">
            Submit evidence
          </button>
        </form>
        <form className="card grid" style={{ gap: 10 }} onSubmit={uploadAttachment}>
          <h3 style={{ margin: 0 }}>Add attachment</h3>
          <div className="grid" style={{ gap: 8 }}>
            <div className="muted">Selected evidence</div>
            {attachId ? (
              <div
                className="card"
                style={{ margin: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div className="muted">Evidence #{attachId}</div>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setAttachId("")}
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="muted">No evidence selected</div>
            )}
            <button className="btn secondary" type="button" onClick={() => setEvidencePickerOpen(true)}>
              Choose evidence
            </button>
          </div>
          <input
            placeholder="Description"
            value={attachDesc}
            onChange={(e) => setAttachDesc(e.target.value)}
            className="input"
          />
          <input
            type="file"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (!files.length) return;
              setAttachFiles((prev) => [...prev, ...files]);
              e.currentTarget.value = "";
            }}
            className="input"
          />
          {attachFiles.length > 0 && (
            <div className="card" style={{ margin: 0 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                Selected files
              </div>
              <div style={{ display: "grid", gap: 6, maxHeight: 160, overflowY: "auto" }}>
                {attachFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${file.size}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span className="muted">{file.name}</span>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setAttachFiles((prev) => prev.filter((_, idx) => idx !== index))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button className="btn secondary" type="submit">
            Upload
          </button>
        </form>
        <div className="grid" style={{ gap: 12 }}>
          {evidences.map((ev: any) => (
            <div key={ev.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <h3 style={{ margin: 0 }}>{ev.title}</h3>
                <span className="pill">{ev.status}</span>
              </div>
              <p className="muted">{ev.description}</p>
              <div className="pill">Type: {ev.type}</div>
              {ev.recorded_at && <div className="muted">Recorded: {new Date(ev.recorded_at).toLocaleString()}</div>}
              {ev.extra_data?.owner_name && (
                <div className="muted">Owner: {ev.extra_data.owner_name}</div>
              )}
              {ev.extra_data?.model && (
                <div className="muted">
                  Vehicle: {ev.extra_data.model} · {ev.extra_data.color}
                </div>
              )}
              {(ev.extra_data?.plate_number || ev.extra_data?.serial_number) && (
                <div className="muted">
                  Plate: {ev.extra_data.plate_number || "-"} · Serial: {ev.extra_data.serial_number || "-"}
                </div>
              )}
              {ev.extra_data?.transcript && (
                <div className="muted">Transcript: {ev.extra_data.transcript}</div>
              )}
              {ev.extra_data?.forensic_result && (
                <div className="muted">Forensic: {ev.extra_data.forensic_result}</div>
              )}
              <div className="muted">
                Case: {ev.case ? `#${ev.case}` : "Unassigned (waiting for detective mapping)"}
              </div>
              <div className="muted">Attachments: {ev.attachments?.length || 0}</div>
              {ev.recorded_by_national_id && (
                <div className="muted">Submitted by (National ID): {ev.recorded_by_national_id}</div>
              )}
              {ev.recorded_by_roles?.length ? (
                <div className="muted">Submitter roles: {ev.recorded_by_roles.join(", ")}</div>
              ) : null}
              {isCoroner && ev.type === "forensic" && ev.status === "pending" && (
                <div className="action-row">
                  <button className="btn secondary" onClick={() => reviewEvidence(ev.id, "reject")}>
                    Remove
                  </button>
                  <button className="btn" onClick={() => reviewEvidence(ev.id, "approve")}>
                    Approve
                  </button>
                </div>
              )}
              {isDetective && !ev.case && !isPoliceSubmitter(ev.recorded_by_roles || []) && (
                <div className="card" style={{ marginTop: 10 }}>
                  <div className="muted">Assign this citizen evidence to a case</div>
                  <div className="action-row" style={{ marginTop: 8 }}>
                    <select
                      className="select"
                      value={assignCaseByEvidence[ev.id] || ""}
                      onChange={(e) =>
                        setAssignCaseByEvidence((prev) => ({ ...prev, [ev.id]: e.target.value }))
                      }
                    >
                      <option value="">Choose case</option>
                      {openCases.map((c: any) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.title || "Untitled case"} {c.number ? `(${c.number})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn"
                      onClick={() => assignCitizenEvidence(ev.id)}
                      disabled={assignBusyId === ev.id}
                    >
                      {assignBusyId === ev.id ? "Assigning..." : "Assign to case"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!evidences.length && <div className="empty">No evidence recorded.</div>}
        </div>
        {casePickerOpen && (
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
            <div className="card" style={{ maxWidth: 720, width: "100%", maxHeight: "80vh", overflow: "hidden" }}>
              <div className="section-title">
                <div>
                  <div className="pill">Select case</div>
                  <h3 style={{ margin: "8px 0 4px" }}>Available cases</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    Choose any case you have access to.
                  </p>
                </div>
                <button className="btn secondary" type="button" onClick={() => setCasePickerOpen(false)}>
                  Close
                </button>
              </div>
              <div className="grid" style={{ gap: 10, marginTop: 12, maxHeight: "60vh", overflowY: "auto" }}>
                {openCases.map((c: any) => (
                  <button
                    key={c.id}
                    className="card"
                    style={{ textAlign: "left", cursor: "pointer" }}
                  onClick={() => {
                      setPayload({ ...payload, case: String(c.id) });
                      setCasePickerOpen(false);
                    }}
                  >
                    <strong>{c.title || "Untitled case"}</strong>
                    <div className="muted">{c.number ? `Case code: ${c.number}` : "Case code: —"}</div>
                    <div className="muted">{c.status_label || c.status}</div>
                  </button>
                ))}
                {!openCases.length && <div className="empty">No active cases available.</div>}
              </div>
              <div className="action-row" style={{ marginTop: 12 }}>
                <button className="btn secondary" type="button" onClick={() => setCasePickerOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {evidencePickerOpen && (
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
            <div className="card" style={{ maxWidth: 720, width: "100%", maxHeight: "80vh", overflow: "hidden" }}>
              <div className="section-title">
                <div>
                  <div className="pill">Select evidence</div>
                  <h3 style={{ margin: "8px 0 4px" }}>Available evidence items</h3>
                </div>
                <button className="btn secondary" type="button" onClick={() => setEvidencePickerOpen(false)}>
                  Close
                </button>
              </div>
              <div className="grid" style={{ gap: 10, marginTop: 12, maxHeight: "60vh", overflowY: "auto" }}>
                {evidences.map((ev: any) => (
                  <button
                    key={ev.id}
                    className="card"
                    style={{ textAlign: "left", cursor: "pointer" }}
                    onClick={() => {
                      setAttachId(String(ev.id));
                      setEvidencePickerOpen(false);
                    }}
                  >
                    <div className="muted">Evidence #{ev.id}</div>
                    <strong>{ev.title}</strong>
                    <div className="muted">{ev.status}</div>
                  </button>
                ))}
                {!evidences.length && <div className="empty">No evidence recorded yet.</div>}
              </div>
              <div className="action-row" style={{ marginTop: 12 }}>
                <button className="btn secondary" type="button" onClick={() => setEvidencePickerOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
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
          >
            <div className="card" style={{ maxWidth: 520, width: "100%" }}>
              <div className="section-title">
                <div>
                  <div className="pill" style={{ background: "rgba(239, 68, 68, 0.12)", color: "var(--danger)" }}>
                    Error
                  </div>
                  <h3 style={{ margin: "8px 0 4px" }}>{errorDialog.title}</h3>
                </div>
                <button className="btn secondary" type="button" onClick={() => setErrorDialog(null)}>
                  Close
                </button>
              </div>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  margin: 0,
                  color: "var(--danger)",
                  fontFamily: "inherit",
                }}
              >
                {errorDialog.message}
              </pre>
            </div>
          </div>
        )}
      </div>
  );
}
