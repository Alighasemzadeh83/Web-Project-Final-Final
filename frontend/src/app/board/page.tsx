"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import RoleGate from "../../components/RoleGate";
import { useAuth } from "../../lib/useAuth";
import { hasAnyRole } from "../../lib/roles";
import PageSkeleton from "../../components/PageSkeleton";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

type Note = { id: number; board: number; label: string; x: number; y: number; color?: string; evidence?: number | null };
type Link = { id: number; board: number; source: number; target: number };

const NOTE_WIDTH = 200;
const NOTE_HEIGHT = 90;
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;

const palette = ["#f6ad55", "#63b3ed", "#4fd1c5", "#f56565", "#ed64a6"];
const boardPalette = ["#2a2018", "#2c2f3a", "#1f2f2e", "#3a2a2a", "#2a3a2a"];

export default function BoardPage() {
  const { user } = useAuth();
  const canAccess = hasAnyRole(user, ["Detective"]);
  const { data: boardData, mutate: refreshBoards } = useSWR(user && canAccess ? endpoints.board : null, fetcher);
  const { data: noteData, mutate: refreshNotes } = useSWR(user && canAccess ? endpoints.boardNotes : null, fetcher);
  const { data: linkData, mutate: refreshLinks } = useSWR(user && canAccess ? endpoints.boardLinks : null, fetcher);
  const { data: casesData } = useSWR(user && canAccess ? endpoints.cases : null, fetcher);
  const isDataLoading =
    !!user && canAccess && (boardData === undefined || noteData === undefined || linkData === undefined || casesData === undefined);
  const boards = boardData?.results || [];
  const notesAll = noteData?.results || [];
  const linksAll = linkData?.results || [];

  const [caseId, setCaseId] = useState("");
  const [activeBoardId, setActiveBoardId] = useState<number | null>(boards[0]?.id || null);
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [noteLabel, setNoteLabel] = useState("");
  const [noteColor, setNoteColor] = useState(palette[0]);
  const [err, setErr] = useState("");
  const [linkFrom, setLinkFrom] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const boardCanvasRef = useRef<HTMLDivElement | null>(null);
  const [dragPositions, setDragPositions] = useState<Record<number, { x: number; y: number }>>({});
  const dragPositionsRef = useRef<Record<number, { x: number; y: number }>>({});
  const dragRaf = useRef<number | null>(null);
  const [detailNoteId, setDetailNoteId] = useState<number | null>(null);
  const [boardColor, setBoardColor] = useState("#2a2018");

  const activeBoard = useMemo(
    () => boards.find((b: any) => b.id === activeBoardId) || null,
    [boards, activeBoardId]
  );
  const activeCaseId = activeBoard?.case;
  const boardBaseColor = activeBoard?.background_color || "#2a2018";
  const boardGradient = useMemo(() => makeBoardGradient(boardColor), [boardColor]);
  const { data: evidenceData } = useSWR(
    user && canAccess && activeCaseId ? `${endpoints.evidences}?case=${activeCaseId}` : null,
    fetcher
  );
  const evidences = evidenceData?.results || evidenceData || [];
  const detectiveCases = useMemo(
    () =>
      (casesData?.results || []).filter(
        (c: any) =>
          c.approval_stage === "detective" &&
          ["detective_pending", "sergeant_pending", "active", "detective_followup", "in_progress"].includes(c.status)
      ),
    [casesData]
  );
  const boardGridTemplate = "minmax(0, 1fr)";

  const notes = useMemo(
    () => notesAll.filter((n: Note) => n.board === activeBoardId),
    [notesAll, activeBoardId]
  );
  const links = useMemo(
    () => linksAll.filter((l: Link) => l.board === activeBoardId),
    [linksAll, activeBoardId]
  );
  const renderedNotes = useMemo(
    () =>
      notes.map((n: Note) => {
        const pos = dragPositions[n.id];
        return pos ? { ...n, ...pos } : n;
      }),
    [notes, dragPositions]
  );
  const evidenceById = useMemo(() => {
    const map = new Map<number, any>();
    (evidences || []).forEach((ev: any) => map.set(ev.id, ev));
    return map;
  }, [evidences]);
  const noteById = useMemo(() => {
    const map = new Map<number, Note>();
    renderedNotes.forEach((n: Note) => map.set(n.id, n));
    return map;
  }, [renderedNotes]);
  const evidenceOnBoard = useMemo(() => {
    const set = new Set<number>();
    notesAll.forEach((n: Note) => {
      if (n.evidence) set.add(n.evidence);
    });
    return set;
  }, [notesAll]);

  useEffect(() => {
    if (!activeBoardId && boards.length) {
      setActiveBoardId(boards[0].id);
    }
  }, [boards, activeBoardId]);

  useEffect(() => {
    setLinkFrom(null);
    setDetailNoteId(null);
  }, [activeBoardId]);

  useEffect(() => {
    setBoardColor(boardBaseColor);
  }, [boardBaseColor, activeBoardId]);

  const createBoard = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      if (!caseId) {
        setErr("Please choose a case first.");
        return;
      }
      const res = await api.post(endpoints.board, { case: caseId });
      setCaseId("");
      refreshBoards();
      setActiveBoardId(res.data.id);
    } catch (ex: any) {
      setErr(getApiErrorMessage(ex, "Unable to create board"));
    }
  };

  const createNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeBoardId) return;
    await api.post(endpoints.boardNotes, {
      board: activeBoardId,
      label: noteLabel,
      x: 120 + Math.floor(Math.random() * 200),
      y: 120 + Math.floor(Math.random() * 140),
      color: noteColor,
    });
    setNoteLabel("");
    refreshNotes();
  };

  const updateBoardColor = async (color: string) => {
    if (!activeBoardId) return;
    setBoardColor(color);
    await api.patch(`${endpoints.board}${activeBoardId}/`, { background_color: color });
    refreshBoards();
  };

  const addEvidenceNote = async (ev: any) => {
    if (!activeBoardId) return;
    const already = notesAll.some((n: Note) => n.board === activeBoardId && n.evidence === ev.id);
    if (already) {
      setErr("This evidence is already on the board.");
      return;
    }
    await api.post(endpoints.boardNotes, {
      board: activeBoardId,
      label: ev.title,
      x: 140 + Math.floor(Math.random() * 200),
      y: 140 + Math.floor(Math.random() * 140),
      color: evidenceColor(ev) || noteColor,
      evidence: ev.id,
    });
    refreshNotes();
  };

  const createLink = async (targetId: number) => {
    if (!activeBoardId || !linkFrom || linkFrom === targetId) return;
    const exists = links.some(
      (l: Link) =>
        (l.source === linkFrom && l.target === targetId) ||
        (l.source === targetId && l.target === linkFrom)
    );
    if (exists) {
      setLinkFrom(null);
      return;
    }
    await api.post(endpoints.boardLinks, { board: activeBoardId, source: linkFrom, target: targetId });
    setLinkFrom(null);
    refreshLinks();
  };

  const removeLink = async (id: number) => {
    await api.delete(`${endpoints.boardLinks}${id}/`);
    refreshLinks();
  };

  const removeNote = async (noteId: number) => {
    await api.delete(`${endpoints.boardNotes}${noteId}/`);
    setDetailNoteId((prev) => (prev === noteId ? null : prev));
    setLinkFrom((prev) => (prev === noteId ? null : prev));
    refreshNotes();
  };

  useEffect(() => {
    dragPositionsRef.current = dragPositions;
  }, [dragPositions]);

  const onPointerDown = (id: number, e: React.PointerEvent<HTMLDivElement>) => {
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest("[data-stop-drag='true']")) {
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragId(id);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture is not supported
    }
  };

  useEffect(() => {
    if (dragId === null) return;
    const handleMove = (e: PointerEvent) => {
      const boardRect = boardRef.current?.getBoundingClientRect();
      if (!boardRect || !boardRef.current) return;
      const scrollLeft = boardRef.current.scrollLeft;
      const scrollTop = boardRef.current.scrollTop;
      const x = e.clientX - boardRect.left + scrollLeft - dragOffset.current.x;
      const y = e.clientY - boardRect.top + scrollTop - dragOffset.current.y;
      const boundedX = Math.max(10, Math.min(x, BOARD_WIDTH - NOTE_WIDTH - 10));
      const boundedY = Math.max(10, Math.min(y, BOARD_HEIGHT - NOTE_HEIGHT - 10));
      if (dragRaf.current) {
        cancelAnimationFrame(dragRaf.current);
      }
      dragRaf.current = requestAnimationFrame(() => {
        setDragPositions((prev) => ({ ...prev, [dragId]: { x: boundedX, y: boundedY } }));
      });
    };
    const handleUp = async () => {
      const pos = dragPositionsRef.current[dragId];
      setDragId(null);
      if (dragRaf.current) {
        cancelAnimationFrame(dragRaf.current);
        dragRaf.current = null;
      }
      if (!pos) {
        return;
      }
      setDragPositions((prev) => ({ ...prev, [dragId]: { x: pos.x, y: pos.y } }));
      await api.patch(`${endpoints.boardNotes}${dragId}/`, { x: pos.x, y: pos.y });
      await refreshNotes();
      setDragPositions((prev) => {
        const next = { ...prev };
        delete next[dragId];
        return next;
      });
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      if (dragRaf.current) {
        cancelAnimationFrame(dragRaf.current);
        dragRaf.current = null;
      }
    };
  }, [dragId, notesAll, refreshNotes]);

  const exportBoard = () => {
    if (!activeBoardId) return;
    const width = BOARD_WIDTH;
    const height = BOARD_HEIGHT;
    const gradient = makeBoardGradientStops(boardColor);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
      `<defs><linearGradient id="bg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${gradient.start}"/><stop offset="100%" stop-color="${gradient.end}"/></linearGradient></defs>`,
      `<rect width="100%" height="100%" fill="url(#bg)"/>`,
      ...links.map(
        (l: Link) => {
      const s = renderedNotes.find((n: Note) => n.id === l.source);
      const t = renderedNotes.find((n: Note) => n.id === l.target);
      if (!s || !t) return "";
      const x1 = s.x + NOTE_WIDTH / 2;
      const y1 = s.y + NOTE_HEIGHT / 2;
      const x2 = t.x + NOTE_WIDTH / 2;
      const y2 = t.y + NOTE_HEIGHT / 2;
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b91c1c" stroke-width="3" />`;
        }
      ),
      ...renderedNotes.map(
        (n: Note) =>
          `<g><rect x="${n.x}" y="${n.y}" rx="10" ry="10" width="${NOTE_WIDTH}" height="${NOTE_HEIGHT}" fill="${n.color || "#f6ad55"}"/><text x="${n.x + 10}" y="${n.y + 35}" font-family="Arial" font-size="14" fill="#111">${escapeXml(n.label)}</text></g>`
      ),
      `</svg>`,
    ].join("");
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `board-${activeBoardId}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!user) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Login required</h3>
        <p className="muted">Detective boards are available after sign-in.</p>
      </div>
    );
  }
  if (!canAccess) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Restricted</h3>
        <p className="muted">Detective board access is limited to detectives.</p>
      </div>
    );
  }

  return (
    <RoleGate roles={["Detective"]}>
      {isDataLoading ? (
        <PageSkeleton title="Loading detective board" cards={3} lines={3} />
      ) : (
      <div
        className="grid"
        style={{ gap: 16, width: "100%", gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }}
      >
      <div className="card">
        <div className="pill">Detective Board</div>
        <h3 style={{ margin: "8px 0 4px" }}>Investigation workspace</h3>
        <p className="muted" style={{ margin: 0 }}>
          Drag notes, connect them with red lines, and export the board as an image for your report.
        </p>
      </div>
      <form
        className="card grid"
        style={{ gap: 8, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}
        onSubmit={createBoard}
      >
        <h3 style={{ margin: 0 }}>Create board for a case</h3>
        <div className="grid" style={{ gap: 8, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div className="muted">Selected case</div>
          {caseId ? (
            <div className="card" style={{ margin: 0 }}>
              {(() => {
                const c = detectiveCases.find((item: any) => String(item.id) === String(caseId));
                return (
                  <>
                    <div>
                      <strong>{c?.title || "Untitled case"}</strong>
                    </div>
                    <div className="muted">{c?.number ? `Case code: ${c.number}` : "Case code: —"}</div>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="muted">No case selected</div>
          )}
          <button className="btn secondary" type="button" onClick={() => setCasePickerOpen(true)}>
            Choose case
          </button>
        </div>
        {err && <div style={{ color: "var(--danger)" }}>{err}</div>}
        <button className="btn" type="submit">Create board</button>
      </form>

      <div
        className="grid"
        style={{ gridTemplateColumns: boardGridTemplate, gap: 16, width: "100%", minWidth: 0 }}
      >
        {boards.map((b: any) => (
          <button
            key={b.id}
            className="card"
            style={{
              textAlign: "left",
              cursor: "pointer",
              width: "100%",
              minWidth: 0,
              justifySelf: "stretch",
              display: "block",
              borderColor: b.id === activeBoardId ? "var(--accent)" : "var(--border)",
            }}
            onClick={() => setActiveBoardId(b.id)}
          >
            {(() => {
              const c = (casesData?.results || []).find((item: any) => item.id === b.case);
              return (
                <>
                  <div className="muted">Case {b.case}</div>
                  {c?.title && (
                    <div style={{ fontWeight: 700 }}>
                      Title: {c.title}
                    </div>
                  )}
                </>
              );
            })()}
            <h3 style={{ margin: "6px 0" }}>Board #{b.id}</h3>
            <p className="muted">Click to open and edit notes.</p>
          </button>
        ))}
        {!boards.length && <div className="empty">No boards yet. Create one above.</div>}
      </div>

      {activeBoardId && (
        <div className="card" style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Board Workspace</h3>
            <button className="btn secondary" onClick={exportBoard}>Export SVG</button>
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="muted">Board theme</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              {boardPalette.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateBoardColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    border: boardColor === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.3)",
                    background: c,
                    cursor: "pointer",
                  }}
                  title={`Set board color ${c}`}
                />
              ))}
              <input
                type="color"
                value={boardColor}
                onChange={(e) => setBoardColor(e.target.value)}
                style={{ width: 36, height: 28, padding: 0, border: "1px solid rgba(255,255,255,0.3)" }}
              />
              <button className="btn secondary" type="button" onClick={() => updateBoardColor(boardColor)}>
                Apply
              </button>
            </div>
          </div>
          <form
            onSubmit={createNote}
            className="grid"
            style={{ gap: 10, marginBottom: 12, gridTemplateColumns: "minmax(0, 1fr)" }}
          >
            <label className="muted">
              Note label
              <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
            </label>
            <input
              placeholder="Note label"
              value={noteLabel}
              onChange={(e) => setNoteLabel(e.target.value)}
              required
              className="input"
            />
            <div style={{ display: "flex", gap: 8 }}>
              {palette.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setNoteColor(c)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    border: noteColor === c ? "2px solid white" : "1px solid var(--border)",
                    background: c,
                  }}
                />
              ))}
            </div>
            <button className="btn" type="submit">Add note</button>
          </form>

          <div
            ref={boardRef}
            style={{
              position: "relative",
              height: "70vh",
              minHeight: 520,
              maxHeight: "calc(100vh - 320px)",
              borderRadius: 16,
              background: boardGradient,
              overflow: "auto",
              border: "1px solid rgba(255,255,255,0.05)",
              maxWidth: "100%",
            }}
          >
            <div
              ref={boardCanvasRef}
              style={{
                position: "relative",
                width: BOARD_WIDTH,
                height: BOARD_HEIGHT,
              }}
            >
              <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                {links.map((l: Link) => {
                  const s = noteById.get(l.source);
                  const t = noteById.get(l.target);
                  if (!s || !t) return null;
                  return (
                    <line
                      key={l.id}
                      x1={s.x + NOTE_WIDTH / 2}
                      y1={s.y + NOTE_HEIGHT / 2}
                      x2={t.x + NOTE_WIDTH / 2}
                      y2={t.y + NOTE_HEIGHT / 2}
                      stroke="#b91c1c"
                      strokeWidth={3}
                    />
                  );
                })}
              </svg>
              {renderedNotes.map((n: Note) => {
                const ev = n.evidence ? evidenceById.get(n.evidence) : null;
                const attachments = ev?.attachments || [];
                const preview = attachments.find((a: any) => isImageFile(a.file));
                return (
                <div
                  key={n.id}
                  style={{
                    position: "absolute",
                    left: n.x,
                    top: n.y,
                    width: NOTE_WIDTH,
                    height: NOTE_HEIGHT,
                    padding: "18px 12px 10px",
                    background: n.color || "#f6ad55",
                    color: "#1a202c",
                    borderRadius: 10,
                    cursor: "grab",
                    fontWeight: 700,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    overflow: "hidden",
                    boxShadow: "0 6px 14px rgba(0,0,0,0.18)",
                  }}
                  onPointerDown={(e) => onPointerDown(n.id, e)}
                  onDoubleClick={() => setLinkFrom(linkFrom === n.id ? null : n.id)}
                  onClick={() => {
                    if (!linkFrom) return;
                    if (linkFrom === n.id) {
                      setLinkFrom(null);
                      return;
                    }
                    createLink(n.id);
                  }}
                >
                  <div
                    data-stop-drag="true"
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      display: "flex",
                      gap: 4,
                    }}
                  >
                    <button
                      type="button"
                      data-stop-drag="true"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNote(n.id);
                      }}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        border: "1px solid rgba(0,0,0,0.25)",
                        background: "rgba(255,255,255,0.8)",
                        fontSize: 12,
                        lineHeight: "18px",
                        cursor: "pointer",
                        color: "#9b1c1c",
                      }}
                      title="Remove from board"
                    >
                      ×
                    </button>
                    {ev && (
                      <button
                        type="button"
                        data-stop-drag="true"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLinkFrom(null);
                          setDetailNoteId(detailNoteId === n.id ? null : n.id);
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          border: "1px solid rgba(0,0,0,0.25)",
                          background: "rgba(255,255,255,0.65)",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                        title="Details"
                      >
                        i
                      </button>
                    )}
                  </div>
                  {preview && (
                    <img
                      src={preview.file}
                      alt="Evidence preview"
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        objectFit: "cover",
                        border: "1px solid rgba(0,0,0,0.15)",
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{n.label}</div>
                    {ev && (
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        {ev.type?.replace("_", " ") || "Evidence"}
                      </div>
                    )}
                    {linkFrom === n.id && <div style={{ fontSize: 11 }}>Link mode...</div>}
                  </div>
                </div>
              )})}
              {detailNoteId && noteById.get(detailNoteId) && (
                <div
                  className="card"
                  style={getPopoutStyle(noteById.get(detailNoteId)!, boardCanvasRef.current)}
                >
                  {(() => {
                    const note = noteById.get(detailNoteId)!;
                    const ev = note.evidence ? evidenceById.get(note.evidence) : null;
                    if (!ev) return null;
                    const attachments = ev.attachments || [];
                    const preview = attachments.find((a: any) => isImageFile(a.file));
                    return (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong>Evidence detail</strong>
                          <button className="btn secondary" onClick={() => setDetailNoteId(null)}>Close</button>
                        </div>
                        {preview && (
                          <img
                            src={preview.file}
                            alt="Evidence preview"
                            style={{
                              width: "100%",
                              height: 120,
                              objectFit: "cover",
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              marginTop: 8,
                            }}
                          />
                        )}
                        <div className="muted" style={{ marginTop: 6 }}>
                          <strong>Title:</strong> {ev.title}
                        </div>
                        <div className="muted">
                          <strong>Type:</strong> {ev.type}
                        </div>
                        <div className="muted">
                          <strong>Status:</strong> {ev.status}
                        </div>
                        {ev.description && (
                          <div className="muted" style={{ marginTop: 6 }}>
                            {ev.description}
                          </div>
                        )}
                        {!!attachments.length && (
                          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {attachments.slice(0, 4).map((a: any) => (
                              <div key={a.id} style={{ width: 70 }}>
                                {isImageFile(a.file) ? (
                                  <img
                                    src={a.file}
                                    alt="Attachment"
                                    style={{
                                      width: 70,
                                      height: 50,
                                      objectFit: "cover",
                                      borderRadius: 8,
                                      border: "1px solid var(--border)",
                                    }}
                                  />
                                ) : (
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    Attachment
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Double-click a note to start linking, then click another note to connect with a red line.
          </p>
          <div style={{ marginTop: 16 }}>
            <div className="muted">Case evidence</div>
            <div className="grid" style={{ gap: 10, marginTop: 6, gridTemplateColumns: "minmax(0, 1fr)" }}>
              {(evidences || []).map((ev: any) => (
                <div key={ev.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{ev.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{ev.type} · {ev.status}</div>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => addEvidenceNote(ev)}
                    disabled={evidenceOnBoard.has(ev.id)}
                  >
                    {evidenceOnBoard.has(ev.id) ? "Added" : "Add to board"}
                  </button>
                </div>
              ))}
              {!evidences?.length && <div className="empty">No evidence found for this case.</div>}
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="muted">Connections</div>
            <div className="grid" style={{ gap: 8, marginTop: 6, gridTemplateColumns: "minmax(0, 1fr)" }}>
              {links.map((l: Link) => {
                const s = notes.find((n: Note) => n.id === l.source);
                const t = notes.find((n: Note) => n.id === l.target);
                return (
                  <div key={l.id} className="card" style={{ display: "flex", justifyContent: "space-between" }}>
                    <div className="muted">
                      {s?.label || l.source} → {t?.label || l.target}
                    </div>
                    <button className="btn secondary" onClick={() => removeLink(l.id)}>Remove</button>
                  </div>
                );
              })}
              {!links.length && <div className="empty">No links yet.</div>}
            </div>
          </div>
        </div>
      )}
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
          <div className="card" style={{ maxWidth: 720, width: "100%" }}>
            <div className="section-title">
              <div>
                <div className="pill">Select case</div>
                <h3 style={{ margin: "8px 0 4px" }}>Detective‑stage cases</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Only cases in the detective investigation step are shown.
                </p>
              </div>
              <button className="btn secondary" type="button" onClick={() => setCasePickerOpen(false)}>
                Close
              </button>
            </div>
            <div className="grid" style={{ gap: 10, marginTop: 12 }}>
              {detectiveCases.map((c: any) => (
                <button
                  key={c.id}
                  className="card"
                  style={{ textAlign: "left", cursor: "pointer" }}
                  onClick={() => {
                    setCaseId(String(c.id));
                    setCasePickerOpen(false);
                  }}
                >
                  <strong>{c.title || "Untitled case"}</strong>
                  <div className="muted">{c.number ? `Case code: ${c.number}` : "Case code: —"}</div>
                  <div className="muted">{c.status_label || c.status}</div>
                </button>
              ))}
              {!detectiveCases.length && <div className="empty">No detective‑stage cases available.</div>}
            </div>
          </div>
        </div>
      )}
      </div>
      )}
    </RoleGate>
  );
}

function escapeXml(input: string) {
  return input.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "\"":
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  });
}

function isImageFile(url?: string) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].some((ext) => lower.includes(ext));
}

function getPopoutStyle(note: Note, boardEl: HTMLDivElement | null) {
  const base = {
    position: "absolute" as const,
    width: 260,
    padding: 12,
    zIndex: 20,
    maxHeight: 280,
    overflowY: "auto" as const,
    boxShadow: "0 18px 40px rgba(10, 10, 10, 0.35)",
  };
  if (!boardEl) {
    return { ...base, left: note.x + NOTE_WIDTH + 10, top: note.y };
  }
  const rect = boardEl.getBoundingClientRect();
  const rightSpace = rect.width - (note.x + NOTE_WIDTH);
  const left = rightSpace > 280 ? note.x + NOTE_WIDTH + 10 : Math.max(10, note.x - 270);
  const top = Math.max(10, Math.min(note.y, rect.height - 220));
  return { ...base, left, top };
}

function evidenceColor(ev: any) {
  switch (ev?.type) {
    case "forensic":
      return "#63b3ed";
    case "vehicle":
      return "#4fd1c5";
    case "id_document":
      return "#f6ad55";
    case "testimony":
      return "#ed64a6";
    default:
      return "#f59e0b";
  }
}

function makeBoardGradient(color: string) {
  const start = shadeHex(color, 0.12);
  const end = shadeHex(color, -0.12);
  return `linear-gradient(180deg,${start},${end})`;
}

function makeBoardGradientStops(color: string) {
  return {
    start: shadeHex(color, 0.12),
    end: shadeHex(color, -0.12),
  };
}

function shadeHex(hex: string, percent: number) {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c.split("").map((ch) => ch + ch).join("");
  }
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  const newR = Math.round((t - r) * p + r);
  const newG = Math.round((t - g) * p + g);
  const newB = Math.round((t - b) * p + b);
  return `#${((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
}
