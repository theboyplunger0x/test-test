"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function ResetPasswordInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-red-400 text-[14px] font-bold mb-3">Invalid reset link.</p>
        <button onClick={() => router.push("/")} className="text-white/40 text-[12px] font-bold hover:text-white/70 transition-colors">
          ← Back to MemeBets
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[360px] bg-[#111] border border-white/10 rounded-2xl p-6 shadow-2xl">
      <div className="mb-6">
        <span className="text-[18px] font-black tracking-tight text-white">MemeBets</span>
        <p className="text-[12px] text-white/40 mt-0.5">Set a new password</p>
      </div>

      {done ? (
        <div className="text-center py-4 space-y-4">
          <div className="text-3xl">✓</div>
          <p className="text-white font-black text-[15px]">Password updated!</p>
          <p className="text-white/40 text-[12px]">You can now sign in with your new password.</p>
          <button
            onClick={() => router.push("/")}
            className="w-full py-3 rounded-xl bg-white text-black text-[13px] font-black hover:bg-white/90 transition-all"
          >
            Sign In →
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest mb-1.5 block text-white/40">
              New password
            </label>
            <input
              type="password" autoFocus autoComplete="new-password"
              placeholder="min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/6 border border-white/10 text-white placeholder:text-white/20 focus:border-white/30 focus:bg-white/10 px-3 py-2.5 rounded-xl text-[13px] font-bold outline-none transition-all"
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest mb-1.5 block text-white/40">
              Confirm password
            </label>
            <input
              type="password" autoComplete="new-password"
              placeholder="repeat password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-white/6 border border-white/10 text-white placeholder:text-white/20 focus:border-white/30 focus:bg-white/10 px-3 py-2.5 rounded-xl text-[13px] font-bold outline-none transition-all"
            />
          </div>

          {error && (
            <p className="text-red-400 bg-red-500/10 border border-red-500/20 text-[12px] font-bold px-3 py-2 rounded-xl">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password || !confirm}
            className="w-full py-3 rounded-xl bg-white text-black text-[13px] font-black hover:bg-white/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-1"
          >
            {loading ? "Updating…" : "Update Password"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <Suspense fallback={<div className="text-white/40 text-[13px] font-bold animate-pulse">Loading…</div>}>
        <ResetPasswordInner />
      </Suspense>
    </div>
  );
}
