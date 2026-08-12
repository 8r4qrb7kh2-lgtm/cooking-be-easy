"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { migrateLocalStorageToSupabase } from "@/lib/migrate";
import { isNativeApp } from "@/lib/native";
import { Loader2 } from "lucide-react";
import GooseChefLogo from "./GooseChefLogo";

const DEFAULT_PRODUCTION_APP_URL = "https://cooking-be-easy.vercel.app";

interface AuthContextType {
  user: User | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function resolveOAuthRedirectOrigin() {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (configuredAppUrl) {
    try {
      return new URL(configuredAppUrl).origin;
    } catch {
      // Fall through to runtime origin fallback.
    }
  }

  if (process.env.NODE_ENV === "production") {
    return DEFAULT_PRODUCTION_APP_URL;
  }

  return window.location.origin;
}

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();

    async function init() {
      // Handle OAuth code in URL (from Google redirect)
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        // Clean up the URL
        window.history.replaceState({}, "", window.location.pathname);
      }

      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      if (session?.user) {
        await migrateLocalStorageToSupabase();
      }
      setLoading(false);
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signInWithGoogle() {
    // Inside the iOS shell the Google leg of the flow runs in a separate Safari
    // session (Google rejects embedded web views), so the callback has to come
    // back to the app instead of finishing server-side. See lib/native.ts.
    const native = isNativeApp();
    const callbackUrl = new URL(`${resolveOAuthRedirectOrigin()}/auth/callback`);
    if (native) callbackUrl.searchParams.set("native", "1");

    // Preserve redirect path (e.g. invite URL) through OAuth flow
    const redirect = sessionStorage.getItem("redirectAfterLogin");
    if (redirect) {
      if (native) {
        // That Safari session cannot see cookies we set here, so the
        // destination travels in the URL.
        callbackUrl.searchParams.set("next", redirect);
      } else {
        document.cookie = `redirect_after_login=${redirect};path=/;max-age=600;samesite=lax`;
      }
      sessionStorage.removeItem("redirectAfterLogin");
    }

    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });
  }

  async function signOut() {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setUser(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="text-brand-500 animate-spin" />
      </div>
    );
  }

  // Allow invite pages through without auth (they handle their own sign-in)
  if (!user && pathname.startsWith("/invite")) {
    return (
      <AuthContext.Provider value={{ user, signInWithGoogle, signOut }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <GooseChefLogo size={92} className="mb-4" />
        <p className="text-gray-500 text-sm mb-8 text-center">
          Plan your meals, build your grocery list.
          <br />
          Sign in to sync your recipes across devices.
        </p>
        <button
          onClick={signInWithGoogle}
          className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-300 rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all font-medium text-gray-700"
        >
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
