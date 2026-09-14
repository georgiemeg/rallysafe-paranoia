export function countryName(code?: string | null): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  if (c.length !== 2) return c;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(c.toUpperCase()) ?? c.toUpperCase();
  } catch {
    return c.toUpperCase();
  }
}

export function flagUrl(code?: string | null): string | null {
  const raw = (code ?? "").trim();
  if (raw.length !== 2) return null;
  return `https://cdn.ewrc-results.com/flags/${raw.toLowerCase()}.svg`;
}

export function regionOptions(): { code: string; name: string }[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const codes = (intl.supportedValuesOf?.("region") ?? []).filter((c) => /^[A-Z]{2}$/.test(c));
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    const list = codes
      .map((code) => ({ code, name: dn.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (list.length) return list;
  } catch {
    // fall through
  }
  return [
    { code: "US", name: "United States" },
    { code: "CA", name: "Canada" },
    { code: "GB", name: "United Kingdom" },
    { code: "AU", name: "Australia" },
    { code: "NZ", name: "New Zealand" },
    { code: "IE", name: "Ireland" },
    { code: "FR", name: "France" },
    { code: "DE", name: "Germany" },
    { code: "IT", name: "Italy" },
    { code: "ES", name: "Spain" },
    { code: "PL", name: "Poland" },
    { code: "FI", name: "Finland" },
    { code: "SE", name: "Sweden" },
    { code: "NO", name: "Norway" },
    { code: "JP", name: "Japan" },
  ];
}

export function toCountryCode(raw?: string | null): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const lower = t.toLowerCase();
  const hit = regionOptions().find((o) => o.name.toLowerCase() === lower);
  return hit?.code ?? null;
}

export function ageFromBirthYear(year?: number | null): number | null {
  if (!year || year < 1920 || year > new Date().getFullYear() - 8) return null;
  return new Date().getFullYear() - year;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
