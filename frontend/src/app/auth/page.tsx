"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/useAuth";
import { getApiErrorMessage } from "../../lib/api";

export default function AuthPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState<Record<string, string>>({
    identifier: "",
    password: "",
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    national_id: "",
    phone_number: "",
  });
  const [error, setError] = useState<{ title: string; messages: string[] } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const validators = {
    username: (value: string) => {
      if (!value.trim()) return "Username is required.";
      if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(value)) {
        return "Use 3-30 letters, numbers, dot, dash, or underscore.";
      }
      return "";
    },
    email: (value: string) => {
      if (!value.trim()) return "Email is required.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address.";
      return "";
    },
    first_name: (value: string) => {
      if (!value.trim()) return "First name is required.";
      if (value.trim().length < 2) return "First name is too short.";
      return "";
    },
    last_name: (value: string) => {
      if (!value.trim()) return "Last name is required.";
      if (value.trim().length < 2) return "Last name is too short.";
      return "";
    },
    national_id: (value: string) => {
      if (!value.trim()) return "National ID is required.";
      if (!/^\d{10}$/.test(value)) return "National ID must be 10 digits.";
      return "";
    },
    phone_number: (value: string) => {
      if (!value.trim()) return "Phone number is required.";
      if (!/^\+?\d{10,15}$/.test(value)) {
        return "Enter 10-15 digits, with optional + (e.g. 09123456789 or +989123456789).";
      }
      return "";
    },
    password: (value: string) => {
      if (!value.trim()) return "Password is required.";
      if (value.length < 8) return "Password must be at least 8 characters.";
      return "";
    },
    identifier: (value: string) => {
      if (!value.trim()) return "Identifier is required.";
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      const isPhone = /^\+?\d{10,15}$/.test(value);
      const isNationalId = /^\d{10}$/.test(value);
      const isUsername = /^[a-zA-Z0-9_.-]{3,30}$/.test(value);
      if (!isEmail && !isPhone && !isNationalId && !isUsername) {
        return "Enter a valid username, email, national ID, or phone.";
      }
      return "";
    },
  } as const;

  const validateField = (key: string, value: string) => {
    const fn = (validators as Record<string, (v: string) => string>)[key];
    return fn ? fn(value) : "";
  };

  const validateForm = () => {
    const next: Record<string, string> = {};
    if (mode === "login") {
      next.identifier = validateField("identifier", form.identifier);
      next.password = validateField("password", form.password);
    } else {
      next.username = validateField("username", form.username);
      next.email = validateField("email", form.email);
      next.first_name = validateField("first_name", form.first_name);
      next.last_name = validateField("last_name", form.last_name);
      next.national_id = validateField("national_id", form.national_id);
      next.phone_number = validateField("phone_number", form.phone_number);
      next.password = validateField("password", form.password);
    }
    Object.keys(next).forEach((key) => {
      if (!next[key]) delete next[key];
    });
    return next;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const localErrors = validateForm();
    if (Object.keys(localErrors).length) {
      setFieldErrors(localErrors);
      return;
    }
    setFieldErrors({});
    try {
      if (mode === "login") {
        await login(form.identifier, form.password);
        router.push("/dashboard");
      } else {
        await register({
          username: form.username,
          email: form.email,
          first_name: form.first_name,
          last_name: form.last_name,
          national_id: form.national_id,
          phone_number: form.phone_number,
          password: form.password,
        });
        setMode("login");
      }
    } catch (err: any) {
      const parsed = parseAuthError(err, mode);
      setError({ title: parsed.title, messages: parsed.messages });
      setFieldErrors(parsed.fieldErrors);
    }
  };

  const bind = (key: string) => ({
    value: form[key] || "",
    onChange: (e: any) => {
      const value = e.target.value;
      setForm({ ...form, [key]: value });
      const msg = validateField(key, value);
      setFieldErrors({ ...fieldErrors, [key]: msg });
      if (error) setError(null);
    },
  });

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <div className="pill">Secure Access</div>
        <h2 style={{ margin: "10px 0 6px" }}>Enter the Operations Console</h2>
        <p className="muted" style={{ margin: 0 }}>
          Use your username, email, national ID, or phone to sign in. New officers can register and wait for role assignment.
        </p>
      </div>
      <div className="card" style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <button className={`btn ${mode === "login" ? "" : "secondary"}`} onClick={() => setMode("login")}>
            Login
          </button>
          <button className={`btn ${mode === "register" ? "" : "secondary"}`} onClick={() => setMode("register")}>
            Register
          </button>
        </div>
        <form className="grid" style={{ gap: 12 }} onSubmit={onSubmit}>
          {mode === "login" ? (
            <>
              <Input
                label="Username / Email / National ID / Phone"
                {...bind("identifier")}
                required
                error={fieldErrors.identifier}
              />
              <Input label="Password" type="password" {...bind("password")} required error={fieldErrors.password} />
            </>
          ) : (
            <>
              <Input label="Username" {...bind("username")} required error={fieldErrors.username} />
              <Input label="Email" type="email" {...bind("email")} required error={fieldErrors.email} />
              <div className="grid grid-3">
                <Input label="First name" {...bind("first_name")} required error={fieldErrors.first_name} />
                <Input label="Last name" {...bind("last_name")} required error={fieldErrors.last_name} />
                <Input label="National ID" {...bind("national_id")} required error={fieldErrors.national_id} />
              </div>
              <Input label="Phone number" {...bind("phone_number")} required error={fieldErrors.phone_number} />
              <Input label="Password" type="password" {...bind("password")} required error={fieldErrors.password} />
            </>
          )}
          {error && (
            <div className="card" style={{ borderColor: "rgba(192, 57, 43, 0.4)", background: "rgba(192, 57, 43, 0.08)" }}>
              <strong>{error.title}</strong>
              <ul className="list" style={{ marginTop: 8 }}>
                {error.messages.map((msg, idx) => (
                  <li key={`${msg}-${idx}`} className="muted" style={{ color: "var(--danger)" }}>
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn" type="submit">
            {mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Input(props: any) {
  const { label, error, ...rest } = props;
  const isRequired = !!rest.required;
  return (
    <label className="grid" style={{ gap: 6 }}>
      <span className="muted">
        {label}
        {isRequired && (
          <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
        )}
      </span>
      <input
        {...rest}
        className="input"
        style={error ? { borderColor: "rgba(192, 57, 43, 0.6)", background: "rgba(192, 57, 43, 0.06)" } : undefined}
      />
      {error && <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
    </label>
  );
}

function parseAuthError(err: any, mode: "login" | "register") {
  const title = mode === "login" ? "Login failed" : "Registration failed";
  const fallbackMessage = getApiErrorMessage(err, "Something went wrong. Please try again.");
  const fallback = { title, messages: [fallbackMessage], fieldErrors: {} as Record<string, string> };
  let data = err?.response?.data ?? err?.data;
  if (!data) return fallback;
  if (typeof data === "string") {
    return { title, messages: [data], fieldErrors: {} };
  }
  if (data?.detail) {
    return { title, messages: [data.detail], fieldErrors: {} };
  }
  if (data?.error?.details && typeof data.error.details === "object") {
    const detail = data.error.details as Record<string, any>;
    data = detail;
  } else if (data?.error?.message && !data?.error?.details) {
    return { title, messages: [data.error.message], fieldErrors: {} };
  }
  const labels: Record<string, string> = {
    username: "Username",
    email: "Email",
    password: "Password",
    first_name: "First name",
    last_name: "Last name",
    national_id: "National ID",
    phone_number: "Phone number",
    identifier: "Identifier",
  };
  const fieldOrder =
    mode === "login"
      ? ["identifier", "password"]
      : ["username", "email", "first_name", "last_name", "national_id", "phone_number", "password"];
  const messages: string[] = [];
  const fieldErrors: Record<string, string> = {};
  if (typeof data === "object") {
    Object.entries(data).forEach(([field, value]) => {
      const label = labels[field] || field;
      const values = Array.isArray(value) ? value : [String(value)];
      values.forEach((msg) => {
        const normalized = String(msg).toLowerCase();
        let display = String(msg);
        if (normalized.includes("unique") || normalized.includes("already exists")) {
          display = `This ${label.toLowerCase()} is already registered.`;
        }
        if (labels[field]) {
          fieldErrors[field] = display;
        } else {
          messages.push(`${label}: ${display}`);
        }
      });
    });
  }
  if (!messages.length && !Object.keys(fieldErrors).length) return fallback;
  const orderedMessages: string[] = [];
  fieldOrder.forEach((key) => {
    if (fieldErrors[key]) {
      orderedMessages.push(`${labels[key]}: ${fieldErrors[key]}`);
    }
  });
  messages.forEach((msg) => orderedMessages.push(msg));
  return { title, messages: orderedMessages, fieldErrors };
}
