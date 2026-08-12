import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { NATIVE_AUTH_CALLBACK_URL } from "@/lib/native";

const DEFAULT_PRODUCTION_APP_URL = "https://cooking-be-easy.vercel.app";

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim();
}

function getRequestOrigin(request: NextRequest) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));

  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }

  const host = firstHeaderValue(request.headers.get("host"));
  if (host) {
    const protocol = host.includes("localhost") ? "http" : "https";
    return `${protocol}://${host}`;
  }

  return new URL(request.url).origin;
}

function getAppOrigin(request: NextRequest) {
  const configuredAppUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;

  if (configuredAppUrl) {
    try {
      return new URL(configuredAppUrl).origin;
    } catch {
      // Fall through to request-based origin fallback.
    }
  }

  if (process.env.NODE_ENV === "production") {
    return DEFAULT_PRODUCTION_APP_URL;
  }

  return getRequestOrigin(request);
}

// The iOS shell runs Google sign-in in its own Safari session, so this request
// arrives with a cookie jar the app's web view will never see. Exchanging the
// code here would burn it and leave the app signed out, so hand it straight
// back over the app's URL scheme and let the web view — which is holding the
// PKCE verifier — do the exchange. See lib/native.ts.
function nativeHandoff(searchParams: URLSearchParams) {
  const target = new URL(NATIVE_AUTH_CALLBACK_URL);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const error =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (code) target.searchParams.set("code", code);
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    target.searchParams.set("next", next);
  }
  if (error) target.searchParams.set("error", error);

  // Built by hand rather than with NextResponse.redirect, which only accepts
  // http(s) URLs.
  return new NextResponse(null, {
    status: 302,
    headers: { Location: target.toString() },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getAppOrigin(request);
  const code = searchParams.get("code");

  if (searchParams.get("native") === "1") {
    return nativeHandoff(searchParams);
  }

  const cookieStore = await cookies();

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    await supabase.auth.exchangeCodeForSession(code);
  }

  // Check for a redirect cookie (e.g. from invite flow)
  const redirectPath = cookieStore.get("redirect_after_login")?.value;
  if (redirectPath) {
    cookieStore.delete("redirect_after_login");
    if (redirectPath.startsWith("/") && !redirectPath.startsWith("//")) {
      return NextResponse.redirect(`${origin}${redirectPath}`);
    }
  }

  return NextResponse.redirect(`${origin}/recipes`);
}
