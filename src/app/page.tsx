"use client";

import { Component, type ReactNode } from "react";
import FeedPage from "@/components/FeedPage";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "white", background: "#111", fontFamily: "monospace" }}>
          <h1 style={{ color: "red" }}>Crash caught:</h1>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.6 }}>{this.state.error.stack}</pre>
          <button onClick={() => { localStorage.removeItem("fud_tab"); window.location.reload(); }}
            style={{ marginTop: 20, padding: "10px 20px", background: "blue", color: "white", border: "none", borderRadius: 8, cursor: "pointer" }}>
            Reset &amp; Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Home() {
  return (
    <ErrorBoundary>
      <FeedPage />
    </ErrorBoundary>
  );
}
