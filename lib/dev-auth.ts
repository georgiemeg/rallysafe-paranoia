import { getSessionUser, normalizeUsername, type PublicUser } from "@/lib/auth";

const HARD_ADMINS = ["georgiemegennis"];

export function isHardAdmin(username: string | null | undefined): boolean {
  const n = normalizeUsername(username || "");
  if (!n) return false;
  if (HARD_ADMINS.includes(n)) return true;
  const envOwner = (process.env.OWNER_USERNAME || "").trim().toLowerCase();
  return Boolean(envOwner && n === envOwner);
}

/** Username-only check (hard-locked accounts). Prefer isAdminUser when you have a session. */
export function isAdminUsername(username: string | null | undefined): boolean {
  return isHardAdmin(username);
}

export function isAdminUser(user: { username?: string | null; role?: string | null } | null | undefined): boolean {
  if (!user) return false;
  if (isHardAdmin(user.username)) return true;
  return (user.role || "").toLowerCase() === "admin";
}

export async function canSeeTestEvent(): Promise<boolean> {
  const user = await getSessionUser().catch(() => null);
  return isAdminUser(user);
}

export async function requireOwner(): Promise<PublicUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  if (!isAdminUser(user)) return null;
  return user;
}
