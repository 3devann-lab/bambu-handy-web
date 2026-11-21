"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client";

type Step = "password" | "code" | "tfa";
type Region = "global" | "china";

interface LoginReply {
  status: "ok" | "verifyCode" | "tfa" | "sent";
  tfaKey?: string;
  fallback?: boolean;
}

const REASONS: Record<string, { tone: "info" | "warn"; text: string }> = {
  expired: { tone: "warn", text: "Your Bambu session expired. Please log in again." },
  login: { tone: "info", text: "Please log in to continue." },
  loggedout: { tone: "info", text: "You've been logged out. Nothing about you is stored here." },
};

export default function LoginForm({ reason, next, instanceNote }: { reason?: string; next?: string; instanceNote?: string }) {
  const [step, setStep] = useState<Step>("password");
  const [region, setRegion] = useState<Region>("global");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // The 2FA challenge key lives only in this component's memory.
  const [tfaKey, setTfaKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, [step]);

  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/printers";

  function handle(reply: LoginReply) {
    setPassword(""); // drop it from memory as soon as Bambu has answered
    if (reply.status === "ok") {
      window.location.assign(destination);
      return;
    }
    if (reply.status === "verifyCode") {
      setStep("code");
      setCode("");
      setNotice(
        reply.fallback
          ? "Bambu's authenticator check is unavailable right now, so we asked Bambu to email you a login code instead."
          : "Bambu wants to confirm it's you. Check your email for a verification code. If none arrives, use “Send me a code”.",
      );
      return;
    }
    if (reply.status === "tfa" && reply.tfaKey) {
      setTfaKey(reply.tfaKey);
      setStep("tfa");
      setCode("");
      setNotice("Enter the 6-digit code from your authenticator app.");
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => handle(await api<LoginReply>("/api/auth/login", { body: { account, password, region } })));
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => handle(await api<LoginReply>("/api/auth/code", { body: { account, code, region } })));
  };

  const submitTfa = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => handle(await api<LoginReply>("/api/auth/tfa", { body: { account, tfaKey, tfaCode: code, region } })));
  };

  const sendCode = () =>
    run(async () => {
      if (!account) throw new ApiError("BAD_REQUEST", "Enter your email first.", 400);
      await api<LoginReply>("/api/auth/send-code", { body: { account, region } });
      setStep("code");
      setCode("");
      setNotice(`We asked Bambu to send a login code to ${account}. It can take a minute to arrive.`);
    });

  const back = () => {
    setStep("password");
    setNotice(null);
    setError(null);
    setTfaKey("");
  };

  const banner = reason ? REASONS[reason] : undefined;

  return (
    <div className="center-narrow stack">
      <div>
        <h1>Log in with your Bambu Lab account</h1>
        <p className="muted">
          Your email and password go straight through to Bambu Lab&apos;s login service. This site never stores
          them. <a href="/privacy">See exactly how.</a>
        </p>
      </div>

      {instanceNote && <div className="alert info"><p>{instanceNote}</p></div>}
      {banner && step === "password" && (
        <div className={`alert ${banner.tone}`} role="status">
          <p>{banner.text}</p>
        </div>
      )}
      {notice && (
        <div className="alert info" role="status">
          <p>{notice}</p>
        </div>
      )}
      {error && (
        <div className="alert bad" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="card">
        {step === "password" && (
          <form onSubmit={submitPassword} noValidate>
            <div className="field">
              <span id="region-label" style={{ fontWeight: 700 }}>
                Account region
              </span>
              <div className="segmented" role="group" aria-labelledby="region-label">
                <button type="button" aria-pressed={region === "global"} onClick={() => setRegion("global")}>
                  Global
                </button>
                <button type="button" aria-pressed={region === "china"} onClick={() => setRegion("china")}>
                  China (bambulab.cn)
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="account">Email or phone</label>
              <input
                ref={firstField}
                id="account"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <span className="hint">
                Signed up with Google, Apple or Facebook? Set a password in Bambu Handy first (Account Security →
                Change Password), or try an emailed code below.
              </span>
            </div>
            <div className="stack">
              <button className="btn btn-primary btn-block" type="submit" disabled={busy || !account || !password}>
                {busy ? "Contacting Bambu…" : "Log in"}
              </button>
              <button className="btn btn-ghost btn-block" type="button" onClick={sendCode} disabled={busy || !account}>
                Email me a login code instead
              </button>
            </div>
          </form>
        )}

        {(step === "code" || step === "tfa") && (
          <form onSubmit={step === "code" ? submitCode : submitTfa} noValidate>
            <div className="field">
              <label htmlFor="code">{step === "code" ? "Verification code from your email" : "Authenticator code"}</label>
              <input
                ref={firstField}
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              <span className="hint">Signing in as {account}</span>
            </div>
            <div className="stack">
              <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.length < 4}>
                {busy ? "Checking…" : "Verify"}
              </button>
              {step === "code" && (
                <button className="btn btn-ghost btn-block" type="button" onClick={sendCode} disabled={busy}>
                  Send me a code
                </button>
              )}
              <button className="btn btn-ghost btn-block" type="button" onClick={back} disabled={busy}>
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
