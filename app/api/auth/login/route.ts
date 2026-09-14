import { NextRequest, NextResponse } from "next/server";
import { loginUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await loginUser(String(body.username ?? ""), String(body.password ?? ""));
    if (!result.ok) {
      return NextResponse.json({ error: "Username or password is wrong." }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true, user: result.user });
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not sign in. Try again." }, { status: 500 });
  }
}
