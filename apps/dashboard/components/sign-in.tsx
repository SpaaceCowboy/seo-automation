"use client";
import { useState, type FormEvent } from "react";
export function SignIn() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = e.currentTarget,
      token = new FormData(form).get("token");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Too many sign-in attempts. Try again in a minute."
            : response.status === 503
              ? "The private API is unavailable or access is not configured."
              : "Sign-in failed. Check your named credential.",
        );
      form.reset();
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-card">
        <div className="brand">R</div>
        <p className="eyebrow">Roco / Private workspace</p>
        <h1>SEO Control Center</h1>
        <p>Evidence, human decisions, measured outcomes.</p>
        <form
          onSubmit={(e) => {
            void submit(e);
          }}
        >
          <label htmlFor="credential">Named access credential</label>
          <input
            id="credential"
            name="token"
            type="password"
            autoComplete="current-password"
            required
            minLength={32}
            maxLength={256}
          />
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
        <small>
          Access is limited to registered human actors. No website changes are
          performed here.
        </small>
      </section>
    </main>
  );
}
