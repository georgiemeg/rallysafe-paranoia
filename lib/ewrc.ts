import { countryName } from "@/lib/person";

const EWRC = "https://api-next.ewrc-results.com";
const UA = "RallySafeParanoia/1.0 (search proxy; +https://rallysafe-paranoia.vercel.app)";

export type EwrcHit = {
  id: string;
  kind: "driver" | "codriver";
  label: string;
  sub: string;
  href: string;
  country: string;
  age: number | null;
  photoUrl: string | null;
};

type SearchPerson = {
  id: number;
  firstname: string;
  lastname: string;
  flag?: string;
  slug?: string;
  type?: string;
};

export type EwrcResultRow = {
  eventId: number;
  name: string;
  date: string;
  season: number;
  flag: string;
  flagUrl: string | null;
  car: string;
  carLogo: string | null;
  team: string;
  className: string;
  overall: number | null;
  classPos: number | null;
  photoUrl: string | null;
  eventLogo: string | null;
  wonOverall: boolean;
  wonClass: boolean;
};

export type EwrcProfile = {
  id: number;
  kind: "driver" | "codriver";
  name: string;
  lastName: string;
  country: string;
  flagUrl: string | null;
  age: number | null;
  born: string | null;
  photoUrl: string | null;
  bio: string;
  starts: number | null;
  seasons: string | null;
  slug: string;
  overallWins: number;
  classWins: number;
  titles: string[];
  lastResults: EwrcResultRow[];
  gallery: string[];
  carLogos: string[];
  champFlags: string[];
};

export async function ewrcGet(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${EWRC}${path}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function flagUrl(code: string | undefined | null): string | null {
  if (!code) return null;
  const c = code.trim().toLowerCase();
  if (c.length < 2) return null;
  return `https://cdn.ewrc-results.com/flags/${c}.svg`;
}

function photoFileUrl(season: number, directory: string, filename: string): string {
  const dir = directory.replace(/^\/+/, "");
  return `https://photo.ewrc.cz/${season}/${dir}/${filename}.jpg`;
}

function logoUrl(file: string | undefined | null): string | null {
  if (!file) return null;
  return `https://cdn.ewrc-results.com/img/cars/${file}`;
}

type Detail = {
  id: number;
  firstname?: string;
  lastname?: string;
  slug?: string;
  age?: number | null;
  born?: string | null;
  info?: string | null;
  meta_photo?: string | null;
  number_of_starts?: number | null;
  first_season?: number | null;
  last_season?: number | null;
  nation?: { flag?: string; name?: { en?: string } };
  overall_titles?: { season?: number; slug?: string; section_name?: { en?: string } }[];
  cars?: { name?: string; logo?: string }[];
};

type StartEvent = {
  id: number;
  name: string;
  season: number;
  flag?: string;
  slug?: string;
  cancelled?: number;
  entry_id?: number;
  car?: { name?: string; logo?: string };
  team?: string;
  categories?: { name?: string }[];
};

type SeasonBlock = {
  season: number;
  sections?: { wins?: number; flag?: string; slug?: string }[];
  starts?: StartEvent[];
};

function careerWins(blocks: SeasonBlock[]): { overall: number; flags: string[] } {
  let overall = 0;
  const flags: string[] = [];
  for (const b of blocks) {
    for (const s of b.sections ?? []) {
      overall += Number(s.wins) || 0;
      const f = flagUrl(s.flag || s.slug);
      if (f) flags.push(f);
    }
  }
  return { overall, flags: [...new Set(flags)].slice(0, 8) };
}

export async function getEwrcProfile(kind: "driver" | "codriver", id: number): Promise<EwrcProfile | null> {
  const base = kind === "codriver" ? `/codriver/${id}` : `/driver/${id}`;
  const [raw, startsRaw, catsRaw] = await Promise.all([
    ewrcGet(base),
    ewrcGet(`${base}/starts`),
    ewrcGet(`${base}/categories`),
  ]);
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Detail;
  const name = `${d.firstname ?? ""} ${d.lastname ?? ""}`.trim();
  const lastName = (d.lastname ?? "").trim();
  const country = d.nation?.name?.en || countryName(d.nation?.flag);
  const hero =
    d.meta_photo && /^https?:\/\//i.test(d.meta_photo) ? d.meta_photo : flagUrl(d.nation?.flag);
  const seasons = d.first_season && d.last_season ? `${d.first_season}–${d.last_season}` : null;
  const starts = d.number_of_starts ?? null;
  const info = (d.info ?? "").trim();

  const blocks: SeasonBlock[] = Array.isArray(startsRaw) ? (startsRaw as SeasonBlock[]) : [];
  const { flags: champFlags } = careerWins(blocks);
  let overallWins = 0;
  let classWins = 0;
  const cats = catsRaw && typeof catsRaw === "object" ? (catsRaw as { categories?: { key?: string; stats?: { key?: string; value?: number }[] }[] }) : null;
  const rallyStats = cats?.categories?.find((c) => c.key === "lg_rally")?.stats ?? [];
  for (const s of rallyStats) {
    if (s.key === "lg_winsU") overallWins = Number(s.value) || 0;
    if (s.key === "lg_class_wins") classWins = Number(s.value) || 0;
  }
  if (!overallWins) overallWins = careerWins(blocks).overall;
  const titles = [...new Set((d.overall_titles ?? []).map((t) => `${t.section_name?.en ?? ""} ${t.season ?? ""}`.trim()))]
    .filter(Boolean)
    .slice(0, 12);

  const flat: StartEvent[] = [];
  for (const b of blocks) {
    for (const s of b.starts ?? []) {
      if (s.cancelled) continue;
      flat.push(s);
    }
  }
  const last10 = flat.slice(0, 10);

  const lastResults = await Promise.all(
    last10.map(async (s) => {
      const [entryRaw, eventRaw] = await Promise.all([
        s.entry_id ? ewrcGet(`/entry/${s.id}/${s.entry_id}`) : Promise.resolve(null),
        ewrcGet(`/event/${s.id}`),
      ]);
      const entry = (entryRaw && typeof entryRaw === "object" ? entryRaw : {}) as {
        result_oa?: { result?: number };
        result_others?: { result?: number; category?: { name?: string }; section?: { name?: { en?: string } } }[];
      };
      const event = (eventRaw && typeof eventRaw === "object" ? eventRaw : {}) as {
        from_date?: string;
        until_date?: string;
        logo?: string;
      };
      const overall = typeof entry.result_oa?.result === "number" ? entry.result_oa.result : null;
      const classRow = (entry.result_others ?? []).find((r) => r.category?.name);
      const classPos = typeof classRow?.result === "number" ? classRow.result : null;
      const className = classRow?.category?.name || s.categories?.[0]?.name || "";
      const car = s.car?.name || "";
      return {
        eventId: s.id,
        name: s.name,
        date: event.from_date || String(s.season),
        season: s.season,
        flag: s.flag || "",
        flagUrl: flagUrl(s.flag),
        car,
        carLogo: logoUrl(s.car?.logo),
        team: s.team || "",
        className,
        overall,
        classPos,
        photoUrl: null as string | null,
        eventLogo: logoUrl(event.logo),
        wonOverall: overall === 1,
        wonClass: classPos === 1,
      } satisfies EwrcResultRow;
    })
  );

  const classWinsFromLast10 = lastResults.filter((r) => r.wonClass).length;
  if (!classWins) classWins = classWinsFromLast10;
  const seasonsForPhotos = [...new Set(last10.map((s) => s.season))].slice(0, 3);
  const galleries = await Promise.all(
    seasonsForPhotos.map((year) =>
      ewrcGet(`/photo/search?season=${year}&${kind === "codriver" ? "codriver" : "driver"}=${id}&l=20`)
    )
  );
  const gallery: string[] = [];
  const photosByEvent = new Map<number, string>();
  const needle = lastName.toLowerCase();
  for (const g of galleries) {
    if (!Array.isArray(g)) continue;
    for (const ev of g as {
      id?: number;
      season?: number;
      photos?: { directory?: string; filename?: string; slug?: string; season?: number }[];
    }[]) {
      const tagged = (ev.photos ?? []).filter((p) => (p.slug || "").toLowerCase().includes(needle) || !needle);
      for (const p of tagged) {
        if (!p.directory || !p.filename) continue;
        const url = photoFileUrl(p.season || ev.season || 0, p.directory, p.filename);
        if (ev.id && !photosByEvent.has(ev.id)) photosByEvent.set(ev.id, url);
        if (gallery.length < 18) gallery.push(url);
      }
    }
  }
  for (const row of lastResults) {
    row.photoUrl = photosByEvent.get(row.eventId) || gallery[0] || hero || null;
  }

  const carLogos = [...new Set((d.cars ?? []).map((c) => logoUrl(c.logo)).filter(Boolean))] as string[];

  let bio = info;
  if (!bio && starts && seasons) bio = `${starts} starts · ${seasons}`;

  return {
    id: d.id,
    kind,
    name,
    lastName,
    country,
    flagUrl: flagUrl(d.nation?.flag),
    age: typeof d.age === "number" ? d.age : null,
    born: d.born ?? null,
    photoUrl: hero,
    bio,
    starts,
    seasons,
    slug: d.slug ?? "",
    overallWins,
    classWins,
    titles,
    lastResults,
    gallery,
    carLogos,
    champFlags,
  };
}

export async function searchEwrcPeople(q: string): Promise<EwrcHit[]> {
  const raw = q.trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (last.length >= 3) terms.push(last);
    else if (first.length >= 3) terms.push(first);
  } else if (raw.length >= 3) {
    terms.push(raw);
  }
  if (!terms.length) return [];

  const packs = await Promise.all(terms.map((term) => ewrcGet(`/search?query=${encodeURIComponent(term)}&limit=40`)));

  const byId = new Map<string, { kind: "driver" | "codriver"; person: SearchPerson }>();
  const absorb = (kind: "driver" | "codriver", items: SearchPerson[] | undefined) => {
    for (const p of items ?? []) {
      if (!p?.id) continue;
      const key = `${kind}:${p.id}`;
      if (!byId.has(key)) byId.set(key, { kind, person: p });
    }
  };
  for (const pack of packs) {
    if (!pack || typeof pack !== "object") continue;
    const rec = pack as {
      drivers?: { items?: SearchPerson[] };
      codrivers?: { items?: SearchPerson[] };
    };
    absorb("driver", rec.drivers?.items);
    absorb("codriver", rec.codrivers?.items);
  }

  const out: EwrcHit[] = [];
  for (const { kind, person: p } of byId.values()) {
    const label = `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim();
    out.push({
      id: `ewrc:${kind}:${p.id}`,
      kind,
      label,
      sub: "eWRC",
      href: `/people?kind=${kind}&ewrcId=${p.id}&name=${encodeURIComponent(label)}`,
      country: countryName(p.flag),
      age: null,
      photoUrl: flagUrl(p.flag),
    });
  }
  return out;
}
