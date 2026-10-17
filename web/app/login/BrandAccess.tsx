"use client";
import { useEffect, useState } from "react";
import {
  ChartNoAxesColumnIncreasing,
  Eye,
  EyeOff,
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { safeReturnPath } from "@/lib/auth/policy";
import "./login.css";
export default function BrandAccess() {
  const [mode, setMode] = useState<"login" | "register" | "setup">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [brandName, setBrandName] = useState(""),
    [website, setWebsite] = useState(""),
    [token, setToken] = useState(""),
    [show, setShow] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    function readSetup() {
      const setup = new URLSearchParams(window.location.hash.slice(1)).get(
        "setup",
      );
      if (!setup) return;
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      setToken(setup);
      setMode("setup");
      setWorking(true);
      fetch("/api/auth/setup-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: setup }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw Error(data.error);
          setEmail(data.email);
          setBrandName(data.brandName);
        })
        .catch((e) => setError(e.message || "Setup is unavailable."))
        .finally(() => setWorking(false));
    }
    const timer = setTimeout(readSetup, 0);
    window.addEventListener("hashchange", readSetup);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", readSetup);
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (working) return;
    setError("");
    if (mode !== "login" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setWorking(true);
    try {
      const response = await fetch("/api/auth/" + mode, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, brandName, website, token }),
      });
      const raw = await response.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw Error("Sign-in is unavailable. Please try again.");
      }
      if (!response.ok) throw Error(data.error || "Sign-in failed.");
      window.location.assign(
        safeReturnPath(new URLSearchParams(window.location.search).get("next")),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setWorking(false);
    }
  }
  function switchMode(next: "login" | "register") {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  }
  return (
    <main className="brand-access">
      <header className="brand-access-logo">
        <ChartNoAxesColumnIncreasing aria-hidden="true" />
        <span>trendCraft.ai</span>
      </header>
      <section className="brand-access-form" aria-labelledby="access-title">
        <div className="brand-access-heading">
          <LockKeyhole aria-hidden="true" />
          <h1 id="access-title">
            {mode === "setup"
              ? "Set up GloVibe access"
              : mode === "register"
                ? "Create your brand account"
                : "Sign in to your brand"}
          </h1>
        </div>
        {mode !== "setup" && (
          <div
            className="brand-access-tabs"
            role="group"
            aria-label="Account access"
          >
            <button
              type="button"
              aria-pressed={mode === "login"}
              onClick={() => switchMode("login")}
              disabled={working}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "register"}
              onClick={() => switchMode("register")}
              disabled={working}
            >
              Create account
            </button>
          </div>
        )}
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <label>
                Brand name
                <input
                  name="brandName"
                  autoComplete="organization"
                  required
                  maxLength={80}
                  value={brandName}
                  disabled={working}
                  onChange={(e) => setBrandName(e.target.value)}
                />
              </label>
              <label>
                Brand website
                <input
                  name="website"
                  autoComplete="url"
                  placeholder="yourbrand.com"
                  required
                  value={website}
                  disabled={working}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              readOnly={mode === "setup"}
              disabled={working}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <div className="brand-access-password">
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={12}
                maxLength={128}
                required
                value={password}
                disabled={working}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
                title={show ? "Hide password" : "Show password"}
                onClick={() => setShow((v) => !v)}
              >
                {show ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
          {mode !== "login" && (
            <>
              <small>12-128 characters</small>
              <label>
                Confirm password
                <input
                  name="confirmPassword"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  value={confirm}
                  disabled={working}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <div className="brand-access-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="brand-access-submit"
            type="submit"
            disabled={working}
          >
            {working ? (
              <LoaderCircle className="brand-access-spin" />
            ) : (
              <ArrowRight />
            )}
            {working
              ? "Please wait..."
              : mode === "setup"
                ? "Set password & open workspace"
                : mode === "register"
                  ? "Create account"
                  : "Sign in"}
          </button>
        </form>
        {mode === "setup" && (
          <button
            className="brand-access-back"
            type="button"
            onClick={() => switchMode("login")}
            disabled={working}
          >
            Back to sign in
          </button>
        )}
      </section>
    </main>
  );
}
