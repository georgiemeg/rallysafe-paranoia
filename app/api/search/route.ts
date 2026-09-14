import { NextRequest, NextResponse } from "next/server";
import { ensureUserSchema, getPool } from "@/lib/db";
import { ageFromBirthYear, countryName } from "@/lib/person";
import { searchEwrcPeople } from "@/lib/ewrc";
import { scoreName } from "@/lib/search-index";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export type SearchHit = {
  id: string;
  kind: "user" | "driver" | "codriver";
  label: string;
  sub: string;
  href: string;
  country: string;
  age: number | null;
  photoUrl: string | null;
  description?: string;
};

type Claimed = {
  username: string;
  country: string;
  birthYear: number | null;
  photoUrl: string | null;
  ewrcId: number;
  ewrcKind: string;
};

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ hits: [] as SearchHit[] });

  const hits: Array<SearchHit & { s: number }> = [];
  const claimed = new Map<string, Claimed>();

  try {
    await ensureUserSchema();
    const claimedRows = await getPool().query(
      `SELECT username_display, country, birth_year, photo_url, ewrc_id, ewrc_kind
       FROM users WHERE ewrc_claim_status = 'approved' AND ewrc_id IS NOT NULL`
    );
    for (const row of claimedRows.rows) {
      const kind = row.ewrc_kind === "codriver" ? "codriver" : "driver";
      claimed.set(`${kind}:${Number(row.ewrc_id)}`, {
        username: String(row.username_display),
        country: countryName(row.country),
        birthYear: row.birth_year == null ? null : Number(row.birth_year),
        photoUrl: row.photo_url ?? null,
        ewrcId: Number(row.ewrc_id),
        ewrcKind: kind,
      });
    }

    const users = await getPool().query(
      `SELECT username_display, country, birth_year, photo_url, ewrc_id, ewrc_kind, ewrc_claim_status FROM users
       WHERE username_normalized LIKE $1 OR username_display ILIKE $2
       LIMIT 16`,
      [`${q.toLowerCase()}%`, `%${q}%`]
    );
    for (const row of users.rows) {
      const name = String(row.username_display);
      const merged = row.ewrc_claim_status === "approved" && row.ewrc_id;
      hits.push({
        id: `user:${name}`,
        kind: "user",
        label: name,
        sub: merged ? "Paranoia · eWRC" : "Paranoia user",
        href: `/u/${encodeURIComponent(name)}`,
        country: countryName(row.country),
        age: ageFromBirthYear(row.birth_year == null ? null : Number(row.birth_year)),
        photoUrl: row.photo_url ?? null,
        s: scoreName(q, name) + (merged ? 20 : 0),
      });
    }
  } catch {
    // still search eWRC
  }

  if (q.length >= 3) {
    try {
      const people = await searchEwrcPeople(q);
      for (const p of people) {
        const num = p.id.split(":")[2];
        const claim = claimed.get(`${p.kind}:${num}`);
        if (claim) {
          hits.push({
            id: `user:${claim.username}`,
            kind: "user",
            label: p.label,
            sub: "Paranoia · eWRC",
            href: `/u/${encodeURIComponent(claim.username)}`,
            country: p.country || claim.country,
            age: p.age ?? ageFromBirthYear(claim.birthYear),
            photoUrl: claim.photoUrl || p.photoUrl,
            s: scoreName(q, p.label) + 25,
          });
          continue;
        }
        hits.push({ ...p, s: scoreName(q, p.label) });
      }
    } catch {
      // eWRC down
    }
  }

  hits.sort((a, b) => b.s - a.s);
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  let usersKept = 0;
  for (const h of hits) {
    if (h.s <= 0) continue;
    const key = h.kind === "user" ? `user:${h.href}` : `${h.kind}:${h.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (h.kind === "user") {
      if (usersKept >= 3) continue;
      usersKept += 1;
    }
    seen.add(key);
    out.push({
      id: h.id,
      kind: h.kind,
      label: h.label,
      sub: h.sub,
      href: h.href,
      country: h.country,
      age: h.age,
      photoUrl: h.photoUrl,
    });
    if (out.length >= 8) break;
  }

  return NextResponse.json({ hits: out });
}
