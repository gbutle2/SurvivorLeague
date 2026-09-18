import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { mustChangePasswordFromMetadata } from "@/lib/members/validation";
import {
  copySessionCookiesOnto,
  isCronNflSyncPath,
  isLoginPath,
  resolveForcedPasswordRedirect,
} from "@/lib/supabase/auth-routing";

/** Copy cookies Supabase attached to the session response onto a redirect. */
export function redirectWithSessionCookies(
  request: NextRequest,
  pathname: string,
  supabaseResponse: NextResponse,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirectResponse = NextResponse.redirect(url);
  copySessionCookiesOnto(supabaseResponse.cookies, {
    set: (cookie) => {
      // Use the ResponseCookie object overload so all attributes are retained.
      redirectResponse.cookies.set(cookie);
    },
  });
  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Vercel cron uses bearer auth on the route — do not require a user cookie.
  if (isCronNflSyncPath(pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    if (!isLoginPath(pathname)) {
      return redirectWithSessionCookies(request, "/login", supabaseResponse);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const destination = resolveForcedPasswordRedirect({
    authenticated: Boolean(user),
    mustChangePassword: mustChangePasswordFromMetadata(user?.app_metadata),
    pathname,
  });

  if (destination) {
    return redirectWithSessionCookies(request, destination, supabaseResponse);
  }

  return supabaseResponse;
}
