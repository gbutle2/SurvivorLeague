import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { mustChangePasswordFromMetadata } from "@/lib/members/validation";
import { resolveForcedPasswordRedirect } from "@/lib/members/policy";

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const pathname = request.nextUrl.pathname;
  const isLoginRoute = pathname.startsWith("/login");

  if (!supabaseUrl || !supabasePublishableKey) {
    if (!isLoginRoute) {
      return redirectTo(request, "/login");
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
    return redirectTo(request, destination);
  }

  return supabaseResponse;
}
