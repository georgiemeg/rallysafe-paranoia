import { NextResponse } from "next/server";
import { ensureUserSchema, getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const name = decodeURIComponent(username).trim().toLowerCase();
  if (!name) return new NextResponse(null, { status: 400 });
  await ensureUserSchema();
  const res = await getPool().query(
    `SELECT photo_bytes, photo_mime FROM users WHERE username_normalized = $1`,
    [name]
  );
  const row = res.rows[0] as { photo_bytes?: Buffer | Uint8Array | null; photo_mime?: string | null } | undefined;
  if (!row?.photo_bytes) return new NextResponse(null, { status: 404 });
  const buf = Buffer.isBuffer(row.photo_bytes) ? row.photo_bytes : Buffer.from(row.photo_bytes);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": row.photo_mime || "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
