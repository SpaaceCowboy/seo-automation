"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login">
      <section className="login-card">
        <h1>Control center unavailable</h1>
        <p role="alert">
          The private API could not be reached. Your data has not been replaced
          with zero values.
        </p>
        <button onClick={reset}>Try again</button>
        <a href="/sign-in">Sign in again</a>
      </section>
    </main>
  );
}
