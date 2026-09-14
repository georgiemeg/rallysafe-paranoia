export type StylePalette = {
  gold: string;
  teal: string;
  orange: string;
  purple: string;
  maroon: string;
  ink?: string;
};

export const STYLE_PALETTES: StylePalette[] = [
  { gold: "#EAD2AC", teal: "#9CAFB7", orange: "#FE938C", purple: "#E6B89C", maroon: "#4281A4" },
  { gold: "#F5DFBB", teal: "#127475", orange: "#FF4E00", purple: "#49416D", maroon: "#0F1108" },
  { gold: "#F5DFBB", teal: "#127475", orange: "#A61C3C", purple: "#A09ABC", maroon: "#A61C3C" },
  { gold: "#F5DFBB", teal: "#127475", orange: "#986C6A", purple: "#986C6A", maroon: "#960200" },
  { gold: "#F5DFBB", teal: "#0E9594", orange: "#127475", purple: "#127475", maroon: "#960200" },
  { gold: "#D5A021", teal: "#1B998B", orange: "#F34213", purple: "#1B998B", maroon: "#960200" },
  { gold: "#D5A021", teal: "#00798C", orange: "#F34213", purple: "#00798C", maroon: "#960200" },
  { gold: "#C9C5CB", teal: "#BAACBD", orange: "#B48EAE", purple: "#B48EAE", maroon: "#646E68" },
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function onFill(bg: string) {
  const white = contrast(bg, "#ffffff");
  const navy = contrast(bg, "#0d1b1e");
  if (navy >= 4.5 && navy > white) return "#0d1b1e";
  if (white >= 4.5) return "#ffffff";
  return navy >= white ? "#0d1b1e" : "#ffffff";
}

export function applyStylePalette(p: StylePalette) {
  const root = document.documentElement;
  root.style.setProperty("--brand-gold", p.gold);
  root.style.setProperty("--brand-teal", p.teal);
  root.style.setProperty("--brand-orange", p.orange);
  root.style.setProperty("--brand-golden-orange", p.purple);
  root.style.setProperty("--brand-maroon", p.maroon);
  root.style.setProperty("--brand-on-gold", onFill(p.gold));
  root.style.setProperty("--brand-on-teal", onFill(p.teal));
  root.style.setProperty("--brand-on-orange", onFill(p.orange));
  root.style.setProperty("--brand-on-purple", onFill(p.purple));
  root.style.setProperty("--brand-on-maroon", onFill(p.maroon));
}

export function pickStylePalette(except?: StylePalette | null) {
  const pool = except ? STYLE_PALETTES.filter((x) => x.gold !== except.gold || x.maroon !== except.maroon) : STYLE_PALETTES;
  return pool[Math.floor(Math.random() * pool.length)] ?? STYLE_PALETTES[0];
}
