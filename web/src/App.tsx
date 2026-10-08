import { useEffect, useState } from "react";
import { api, ApiError, type AppState } from "./api";

type Action = "load" | "increment" | "decrement" | "reset" | "refresh";

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
// Events are sent as `demo-${name}` (e.g. "demo-increment"). Pendo matches
// these names exactly, so don't rename them.
function trackEvent(name: Action | "action-failed", props?: Record<string, unknown>) {
  try {
    if (typeof window !== "undefined") {
      window.pendo?.track?.(`demo-${name}`, props);
    }
  } catch {
    // Tracking must never break the app. Without this, run() would show a
    // tracking error to the user as a failed action.
  }
}

// Properties sent with each action's success event. `prev` is the state that
// was on screen when the action started; `next` is the server's response.
function successProps(action: Action, prev: AppState, next: AppState): Record<string, unknown> {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter: prev.counter };
    case "reset":
      return { previousCounter: prev.counter, previousLastAction: prev.lastAction };
    case "refresh":
      return { counter: next.counter, previousCounter: prev.counter, lastAction: next.lastAction };
  }
}

// React StrictMode runs mount effects twice in development, so the initial
// load would be reported twice. This flag lets run() report only the first
// one. It lives at module level (not in a ref) so it lasts for the whole page
// load, however many times App mounts.
let initialLoadReported = false;

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (name: Action, fn: () => Promise<AppState>) => {
    const prev = state; // what was on screen when the action started
    const report = name !== "load" || !initialLoadReported;
    if (name === "load") initialLoadReported = true;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      if (report) trackEvent(name, successProps(name, prev, next));
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      if (report) {
        trackEvent("action-failed", {
          action: name,
          // Truncated to stay well within Pendo's 512-byte limit on properties.
          errorMessage: message.slice(0, 200),
          // Only HTTP errors have a status; network failures reject without one.
          // Sent as a string so it groups as a category in Data Explorer.
          ...(e instanceof ApiError ? { statusCode: String(e.status) } : {}),
        });
      }
    }
  };

  useEffect(() => {
    run("load", api.getState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>QAWolf Demo</h1>

      <p data-testid="counter-value" style={{ fontSize: "3rem", margin: "1rem 0" }}>
        {state.counter}
      </p>
      <p data-testid="last-action" style={{ color: "#666" }}>
        Last action: {state.lastAction}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button data-testid="btn-increment" onClick={() => run("increment", api.increment)}>
          Increment
        </button>
        <button data-testid="btn-decrement" onClick={() => run("decrement", api.decrement)}>
          Decrement
        </button>
        <button data-testid="btn-reset" onClick={() => run("reset", api.reset)}>
          Reset
        </button>
        <button data-testid="btn-refresh" onClick={() => run("refresh", api.getState)}>
          Refresh
        </button>
      </div>

      {error && (
        <p data-testid="error" style={{ color: "crimson", marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
