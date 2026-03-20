"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function CallbackInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"processing" | "error">("processing");

  useEffect(() => {
    const token     = searchParams.get("token");
    const authError = searchParams.get("auth_error");

    if (authError || !token) {
      setStatus("error");
      return;
    }

    // Save token — FeedPage listens for this storage event to restore session
    localStorage.setItem("token", token);
    window.dispatchEvent(new StorageEvent("storage", { key: "token", newValue: token }));

    router.replace("/");
  }, [searchParams, router]);

  if (status === "error") {
    return (
      <div className="text-center space-y-3">
        <p className="text-red-400 text-[14px] font-bold">Google sign-in failed.</p>
        <button
          onClick={() => router.replace("/")}
          className="text-white/40 text-[12px] font-bold hover:text-white/70 transition-colors"
        >
          ← Back to MemeBets
        </button>
      </div>
    );
  }

  return <div className="text-white/40 text-[13px] font-bold animate-pulse">Signing you in…</div>;
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <Suspense fallback={<div className="text-white/40 text-[13px] font-bold animate-pulse">Loading…</div>}>
        <CallbackInner />
      </Suspense>
    </div>
  );
}
