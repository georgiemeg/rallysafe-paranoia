import { NextResponse } from "next/server";
import { destroySession, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import { computeProfileStats, prefsFromCloud } from "@/lib/cloud";
import { isAdminUser } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  await destroySession(jar.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });
  const { cloud, ...rest } = user;
  let ewrc = null;
  if (user.ewrcId && user.ewrcClaimStatus === "approved") {
    try {
      const { getEwrcProfile } = await import("@/lib/ewrc");
      ewrc = await getEwrcProfile((user.ewrcKind === "codriver" ? "codriver" : "driver"), user.ewrcId);
      if (ewrc && user.photoUrl) ewrc.photoUrl = user.photoUrl;
      if (ewrc && user.country) {
        const { countryName, flagUrl, toCountryCode } = await import("@/lib/person");
        const code = toCountryCode(user.country) || user.country;
        ewrc.country = countryName(code) || user.country;
        const flag = flagUrl(code);
        if (flag) ewrc.flagUrl = flag;
      }
    } catch {
      ewrc = null;
    }
  }
  return NextResponse.json({
    user: { ...rest, isAdmin: isAdminUser(user) },
    prefs: prefsFromCloud(cloud),
    stats: computeProfileStats({
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      cloud,
    }),
    ewrc,
    cloud: cloud
      ? {
          eventId: (cloud as { eventId?: number }).eventId ?? null,
          eventName: (cloud as { eventName?: string }).eventName ?? "",
          phone: (cloud as { phone?: string }).phone ?? null,
          cars: (cloud as { cars?: unknown[] }).cars ?? [],
        }
      : null,
  });
}
