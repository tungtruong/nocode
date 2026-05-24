import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const PROTECTED = ["/builder"];

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (PROTECTED.some((p) => path.startsWith(p))) {
    const session = await getSession();
    if (!session) {
      const url = new URL("/login", req.url);
      url.searchParams.set("redirect", path);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|static|.*\\.).*)"],
};
