import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  const confirm = String(body.confirm ?? "");
  if (password !== confirm) {
    return NextResponse.json({ error: "The passwords must match." }, { status: 400 });
  }
  const result = await createUser({
    username,
    password,
    email: body.email ? String(body.email) : null,
    phone: body.phone ? String(body.phone) : null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
