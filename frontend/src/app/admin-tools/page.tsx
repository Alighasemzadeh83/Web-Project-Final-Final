"use client";

import { useEffect, useState } from "react";
import { api, endpoints, getApiErrorMessage } from "../../lib/api";
import RoleGate from "../../components/RoleGate";
import { useAuth } from "../../lib/useAuth";
import { hasAnyRole } from "../../lib/roles";

export default function AdminToolsPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_superuser || hasAnyRole(user, ["Administrator"]);
  const [seedStatus, setSeedStatus] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [seededOnce, setSeededOnce] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [usersError, setUsersError] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [roles, setRoles] = useState<any[]>([]);
  const [rolesError, setRolesError] = useState("");
  const [rolesLoading, setRolesLoading] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleBase, setNewRoleBase] = useState("");
  const [roleStatus, setRoleStatus] = useState("");
  const [roleSelection, setRoleSelection] = useState<Record<number, number[]>>({});
  const [logs, setLogs] = useState<any[]>([]);
  const [logsError, setLogsError] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsNextUrl, setLogsNextUrl] = useState<string | null>(null);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const citizenRoleId = roles.find((r) => (r?.name || "").toLowerCase() === "citizen")?.id;

  const loadRoles = async () => {
    setRolesError("");
    setRolesLoading(true);
    try {
      const res = await api.get(endpoints.roles);
      setRoles(res.data?.results ?? res.data ?? []);
    } catch (err: any) {
      setRolesError(getApiErrorMessage(err, "Unable to load roles"));
    } finally {
      setRolesLoading(false);
    }
  };

  const loadUsers = async () => {
    setUsersError("");
    setUsersLoading(true);
    try {
      const res = await api.get(endpoints.users);
      const payload = res.data?.results ?? res.data ?? [];
      const filtered = payload.filter((u: any) => {
        const hasAdministratorRole = (u.roles || []).some(
          (r: any) => String(r?.name || "").trim().toLowerCase() === "administrator"
        );
        return !u.is_superuser || hasAdministratorRole;
      });
      setUsers(filtered);
      const selectedRoles: Record<number, number[]> = {};
      filtered.forEach((u: any) => {
        const roleIds = (u.roles || []).map((r: any) => r.id);
        selectedRoles[u.id] = roleIds.length ? roleIds : citizenRoleId ? [citizenRoleId] : [];
      });
      setRoleSelection(selectedRoles);
    } catch (err: any) {
      setUsersError(getApiErrorMessage(err, "Unable to load users"));
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadRoles();
      api
        .get(endpoints.seedStatus)
        .then((res) => setSeededOnce(!!res.data?.already_seeded))
        .catch(() => setSeededOnce(false));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!citizenRoleId) return;
    setRoleSelection((prev) => {
      const next = { ...prev };
      let changed = false;
      users.forEach((u: any) => {
        const selected = next[u.id] || [];
        const roleIds = (u.roles || []).map((r: any) => r.id);
        if (!selected.length && !roleIds.length) {
          next[u.id] = [citizenRoleId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [citizenRoleId, users]);

  const runSeed = async () => {
    setSeedStatus("");
    setBusy(true);
    try {
      const res = await api.post(endpoints.seed);
      if (res.data?.stats?.already_seeded) {
        setSeedStatus("Seed already exists. No changes applied.");
        setSeededOnce(true);
      } else {
        setSeedStatus("Seed workspace created.");
        setSeededOnce(true);
      }
    } catch (err: any) {
      setSeedStatus(getApiErrorMessage(err, "Seed failed."));
    } finally {
      setBusy(false);
    }
  };

  const runReset = async () => {
    setResetStatus("");
    const confirmed = window.confirm("Reset will wipe all data (superusers kept). Continue?");
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.post(endpoints.reset);
      setResetStatus("Reset complete. Superusers preserved. Seed is now available again.");
      setSeededOnce(false);
    } catch (err: any) {
      setResetStatus(getApiErrorMessage(err, "Reset failed."));
    } finally {
      setBusy(false);
    }
  };

  const createRole = async () => {
    setRoleStatus("");
    const name = newRoleName.trim();
    if (!name) {
      setRoleStatus("Role name is required.");
      return;
    }
    try {
      await api.post(endpoints.roles, { name, visibility_role: newRoleBase || "" });
      setNewRoleName("");
      setNewRoleBase("");
      setRoleStatus("Role created.");
      loadRoles();
    } catch (err: any) {
      setRoleStatus(getApiErrorMessage(err, "Failed to create role."));
    }
  };

  const deleteRole = async (id: number) => {
    const role = roles.find((r) => r.id === id);
    const confirmed = window.confirm(`Delete role ${role?.name || id}?`);
    if (!confirmed) return;
    try {
      await api.delete(`${endpoints.roles}${id}/`);
      loadRoles();
    } catch (err: any) {
      setRoleStatus(getApiErrorMessage(err, "Failed to delete role."));
    }
  };

  const saveUserRoles = async (id: number) => {
    try {
      await api.patch(`${endpoints.users}${id}/roles/`, {
        role_ids: roleSelection[id] || [],
      });
      loadUsers();
    } catch (err: any) {
      setUsersError(getApiErrorMessage(err, "Unable to update user."));
    }
  };

  const parseLogPage = (payload: any): { items: any[]; next: string | null } => {
    if (Array.isArray(payload)) return { items: payload, next: null };
    if (Array.isArray(payload?.results)) return { items: payload.results, next: payload.next || null };
    return { items: [], next: null };
  };

  const loadLogs = async (reset = true) => {
    setLogsError("");
    setLogsLoading(true);
    try {
      const targetUrl = reset ? `${endpoints.activityLogs}?page=1` : logsNextUrl;
      if (!targetUrl) {
        setLogsLoading(false);
        return;
      }
      const res = await api.get(targetUrl);
      const { items, next } = parseLogPage(res.data);
      setLogs((prev) => (reset ? items : [...prev, ...items]));
      setLogsNextUrl(next);
      setLogsLoaded(true);
    } catch (err: any) {
      setLogsError(getApiErrorMessage(err, "Unable to load system logs"));
    } finally {
      setLogsLoading(false);
    }
  };

  const downloadLogs = async () => {
    setLogsError("");
    try {
      const res = await api.get(endpoints.activityLogsExport, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      const cd = res.headers?.["content-disposition"] || "";
      const match = /filename=\"?([^\";]+)\"?/i.exec(cd);
      link.href = blobUrl;
      link.download = match?.[1] || `system-logs-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      setLogsError(getApiErrorMessage(err, "Unable to download system logs"));
    }
  };

  return (
    <RoleGate roles={["Administrator"]}>
      <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="pill">Admin Tools</div>
        <h2 style={{ margin: "10px 0 6px" }}>Seed & Reset workspace</h2>
        <p className="muted" style={{ margin: 0 }}>
          Seed creates demo users and roles only (no complaints/cases). Reset wipes all data but keeps superusers. After
          reset you can seed again.
        </p>
        <div className="action-row" style={{ marginTop: 14 }}>
          <button
            className="btn secondary has-tip"
            data-tip="Create demo workspace data"
            title="Create demo workspace data"
            onClick={runSeed}
            disabled={busy || seededOnce}
          >
            Seed Workspace
          </button>
          <button className="btn secondary has-tip" data-tip="Reset all data (superusers kept)" title="Reset all data (superusers kept)" onClick={runReset} disabled={busy}>
            Reset Database
          </button>
        </div>
        {seededOnce && (
          <div className="tag" style={{ marginTop: 10 }}>
            Seed can run once. Use Reset to re-generate the workspace.
          </div>
        )}
        {seedStatus && <div className="tag" style={{ marginTop: 10 }}>{seedStatus}</div>}
        {resetStatus && <div className="tag" style={{ marginTop: 10 }}>{resetStatus}</div>}
        {resetStatus && (
          <div className="action-row">
            <button
              className="btn secondary has-tip"
              data-tip="Reload pages to clear cached data"
              title="Reload pages to clear cached data"
              onClick={() => window.location.reload()}
            >
              Reload UI
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="pill">Users</div>
        <h3 style={{ margin: "10px 0 6px" }}>All user accounts</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Visible to superusers and administrators only.
        </p>
        <div className="action-row">
          <button
            className="btn secondary has-tip"
            data-tip="Load all users"
            title="Load all users"
            onClick={loadUsers}
            disabled={usersLoading}
          >
            Load Users
          </button>
        </div>
        {usersLoading && <p className="muted">Loading users…</p>}
        {usersError && <p className="muted">{usersError}</p>}
        {!usersLoading && !usersError && users.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        multiple
                        className="input"
                        value={(roleSelection[u.id] || []).map(String)}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                          setRoleSelection({ ...roleSelection, [u.id]: selected });
                        }}
                      >
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>{role.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button className="btn secondary" onClick={() => saveUserRoles(u.id)}>Save</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="pill">Roles</div>
        <h3 style={{ margin: "10px 0 6px" }}>Manage roles</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Create roles that inherit visibility from an existing role, or remove roles.
        </p>
        <div className="action-row" style={{ marginTop: 10 }}>
          <input
            className="input"
            placeholder="New role name"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
          />
          <select
            className="input"
            value={newRoleBase}
            onChange={(e) => setNewRoleBase(e.target.value)}
          >
            <option value="">Inherit visibility from…</option>
            {roles.map((role) => (
              <option key={role.id} value={role.name}>{role.name}</option>
            ))}
          </select>
          <button className="btn secondary" onClick={createRole} disabled={!newRoleName.trim()}>
            Create role
          </button>
        </div>
        {roleStatus && <div className="tag" style={{ marginTop: 10 }}>{roleStatus}</div>}
        {rolesLoading && <p className="muted">Loading roles…</p>}
        {rolesError && <p className="muted">{rolesError}</p>}
        {!rolesLoading && roles.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Visible as</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td>{role.name}</td>
                    <td>{role.visibility_role || "—"}</td>
                    <td>
                      <button className="btn secondary" onClick={() => deleteRole(role.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="pill">System Logs</div>
        <h3 style={{ margin: "10px 0 6px" }}>Platform activity log</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          View the latest system events with scroll, or export the full log as CSV.
        </p>
        <div className="action-row">
          <button className="btn secondary" onClick={() => loadLogs(true)} disabled={logsLoading}>
            {logsLoading ? "Loading..." : "Load Logs"}
          </button>
          <button className="btn secondary" onClick={downloadLogs}>
            Download CSV
          </button>
          {!!logsNextUrl && (
            <button className="btn secondary" onClick={() => loadLogs(false)} disabled={logsLoading}>
              {logsLoading ? "Loading..." : "Load More"}
            </button>
          )}
        </div>
        {logsError && <p className="muted">{logsError}</p>}
        {logsLoaded && (
          <div className="table-wrap" style={{ marginTop: 12, maxHeight: 420, overflowY: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id}>
                    <td>{log.created_at ? new Date(log.created_at).toLocaleString() : "—"}</td>
                    <td>{log.actor_username || "system"}</td>
                    <td>{log.action || "—"}</td>
                    <td>{`${log.target_type || "—"} ${log.target_id || ""}`.trim()}</td>
                    <td>{log.message || "—"}</td>
                  </tr>
                ))}
                {!logs.length && (
                  <tr>
                    <td colSpan={5} className="muted">No logs found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </RoleGate>
  );
}
