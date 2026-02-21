"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase";
import { ChefHat, Loader2, Users, CheckCircle2, XCircle } from "lucide-react";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const [status, setStatus] = useState<"loading" | "ready" | "accepting" | "success" | "error">("loading");
  const [inviterEmail, setInviterEmail] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    // Fetch invite details
    async function loadInvite() {
      const supabase = getSupabase();
      const { data: invite } = await supabase
        .from("household_invites")
        .select("created_by, used_by, expires_at")
        .eq("token", token)
        .single();

      if (!invite) {
        setErrorMessage("Invite not found.");
        setStatus("error");
        return;
      }

      if (invite.used_by) {
        setErrorMessage("This invite has already been used.");
        setStatus("error");
        return;
      }

      if (new Date(invite.expires_at) < new Date()) {
        setErrorMessage("This invite has expired.");
        setStatus("error");
        return;
      }

      // We don't have a way to get the email client-side without admin API,
      // so just show a generic message
      setInviterEmail("");
      setStatus("ready");
    }

    loadInvite();
  }, [token]);

  // Check if we returned from OAuth with a pending invite
  useEffect(() => {
    if (user && status === "ready") {
      const pending = sessionStorage.getItem("pendingInviteToken");
      if (pending === token) {
        sessionStorage.removeItem("pendingInviteToken");
        handleAccept();
      }
    }
  }, [user, status]);

  async function handleSignIn() {
    sessionStorage.setItem("pendingInviteToken", token);
    sessionStorage.setItem("redirectAfterLogin", window.location.pathname);
    await signInWithGoogle();
  }

  async function handleAccept() {
    setStatus("accepting");
    try {
      const res = await fetch("/api/household/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMessage(data.error || "Failed to join household.");
        setStatus("error");
        return;
      }

      setStatus("success");
      setTimeout(() => router.push("/recipes"), 2000);
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <ChefHat size={48} className="text-brand-600 mb-4" />

      {status === "loading" && (
        <Loader2 size={32} className="text-brand-500 animate-spin" />
      )}

      {status === "error" && (
        <div className="text-center">
          <XCircle size={40} className="text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Can&apos;t Join
          </h1>
          <p className="text-gray-500 text-sm mb-6">{errorMessage}</p>
          <button
            onClick={() => router.push("/recipes")}
            className="px-6 py-2.5 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors"
          >
            Go to Recipes
          </button>
        </div>
      )}

      {status === "ready" && !user && (
        <div className="text-center">
          <Users size={40} className="text-brand-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            You&apos;ve Been Invited
          </h1>
          <p className="text-gray-500 text-sm mb-6">
            Someone wants to share their recipe library with you.
            <br />
            Sign in to join their household.
          </p>
          <button
            onClick={handleSignIn}
            className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-300 rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all font-medium text-gray-700 mx-auto"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign in with Google
          </button>
        </div>
      )}

      {status === "ready" && user && (
        <div className="text-center">
          <Users size={40} className="text-brand-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Join Shared Library
          </h1>
          <p className="text-gray-500 text-sm mb-6">
            You&apos;ve been invited to share a recipe library.
            <br />
            Your recipes, meal plans, and shopping lists will be shared.
          </p>
          <button
            onClick={handleAccept}
            className="px-6 py-2.5 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors"
          >
            Join Library
          </button>
        </div>
      )}

      {status === "accepting" && (
        <div className="text-center">
          <Loader2 size={32} className="text-brand-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Joining library...</p>
        </div>
      )}

      {status === "success" && (
        <div className="text-center">
          <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            You&apos;re In!
          </h1>
          <p className="text-gray-500 text-sm">
            Redirecting to your shared recipe library...
          </p>
        </div>
      )}
    </div>
  );
}
