import axios from "axios";

const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1";

export const api = axios.create({
  baseURL: apiBase,
});

const cleanParts = (parts: string[]) => parts.filter((p) => p && p.trim());

export const getApiErrorMessage = (error: any, fallback = "Request failed.") => {
  if (!error) return fallback;
  if (error.userMessage) return error.userMessage;
  const data = error?.response?.data ?? error?.data;
  if (!data) return error?.message || fallback;
  if (typeof data === "string") return data;
  if (data.detail) return data.detail;
  if (data.error) {
    if (typeof data.error === "string") return data.error;
    if (typeof data.error?.message === "string") return data.error.message;
  }
  if (Array.isArray(data)) {
    const parts = data.map((item) => String(item));
    return cleanParts(parts).join(" | ") || error?.message || fallback;
  }
  if (typeof data === "object") {
    const parts: string[] = [];
    Object.entries(data).forEach(([key, value]) => {
      if (!value) return;
      const items = Array.isArray(value) ? value : [value];
      items.forEach((item) => {
        const msg = typeof item === "string" ? item : JSON.stringify(item);
        if (!msg) return;
        if (key === "non_field_errors") {
          parts.push(msg);
        } else {
          parts.push(`${key}: ${msg}`);
        }
      });
    });
    const cleaned = cleanParts(parts);
    if (cleaned.length) return cleaned.join(" | ");
  }
  return error?.message || fallback;
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = getApiErrorMessage(error);
    if (message) {
      error.userMessage = message;
      error.message = message;
    }
    return Promise.reject(error);
  }
);

export const setAuthToken = (token?: string) => {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common["Authorization"];
  }
};

export const endpoints = {
  login: "/auth/login/",
  register: "/auth/register/",
  me: "/auth/me/",
  seed: "/auth/seed/",
  seedStatus: "/auth/seed-status/",
  reset: "/auth/reset/",
  superuserStatus: "/auth/superuser-status/",
  superusers: "/auth/superusers/",
  users: "/auth/users/",
  roles: "/auth/roles/",
  metrics: "/metrics/summary/",
  cases: "/cases/",
  fieldReports: "/field-reports/",
  complaints: "/complaints/",
  pursuits: "/pursuits/",
  pursuitsHighAlert: "/pursuits/high-alert/",
  pursuitsPublicHighAlert: "/pursuits/public-high-alert/",
  board: "/boards/",
  boardNotes: "/board-notes/",
  boardLinks: "/board-links/",
  evidences: "/evidences/",
  activityLogs: "/activity-logs/",
  activityLogsExport: "/activity-logs/export/",
  tips: "/tips/",
  trials: "/trials/",
  suspectEvaluations: "/suspect-evaluations/",
  suspectStatus: "/suspect-evaluations/me/",
  bailPayments: "/bail-payments/",
  bailEligible: "/bail-payments/eligible/",
};
