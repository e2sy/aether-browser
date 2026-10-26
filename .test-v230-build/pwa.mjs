// src/shared/pwa.ts
var MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
function parseManifestLink(html) {
  const s = String(html || "").slice(0, MAX_MANIFEST_BYTES);
  const re = /<link\b[^>]*>/gi;
  let m;
  while (m = re.exec(s)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?manifest/i.test(tag)) continue;
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const val = href ? href[1] || href[2] || href[3] || "" : "";
    if (val) return val;
  }
  return null;
}
function resolveUrl(base, rel) {
  try {
    return new URL(String(rel || ""), String(base || "")).toString();
  } catch {
    return null;
  }
}
function parseManifestJson(raw, manifestUrl) {
  let doc;
  try {
    doc = JSON.parse(String(raw || "").slice(0, MAX_MANIFEST_BYTES));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const m = doc;
  const name = typeof m["name"] === "string" && m["name"].trim() ? m["name"].trim() : "";
  const shortName = typeof m["short_name"] === "string" && m["short_name"].trim() ? m["short_name"].trim() : name;
  const startRel = typeof m["start_url"] === "string" ? m["start_url"] : ".";
  const startUrl = resolveUrl(manifestUrl, startRel);
  if (!startUrl || !/^https?:/i.test(startUrl)) return null;
  const display = typeof m["display"] === "string" ? m["display"] : "standalone";
  let icons = [];
  if (Array.isArray(m["icons"])) {
    icons = m["icons"].filter((i) => i && typeof i === "object" && typeof i.src === "string").map((i) => {
      const ic = i;
      return { src: ic.src, sizes: typeof ic.sizes === "string" ? ic.sizes : "", type: typeof ic.type === "string" ? ic.type : "", purpose: typeof ic.purpose === "string" ? ic.purpose : "" };
    }).slice(0, 24);
  }
  return { name, shortName, startUrl, display, icons };
}
function parseIconSizes(sizes) {
  const out = [];
  for (const part of String(sizes || "").split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/i.exec(part);
    if (m) out.push(Math.min(Number(m[1]), Number(m[2])));
  }
  return out;
}
function pickIcon(icons) {
  const list = Array.isArray(icons) ? icons.filter((i) => i && i.src) : [];
  if (!list.length) return null;
  const isRaster = (i) => /png|jpe?g|webp/i.test(`${i.type || ""} ${i.src}`);
  const scored = list.map((i) => {
    const sizes = parseIconSizes(i.sizes || "");
    const big = sizes.length ? Math.max(...sizes) : 0;
    let score = big;
    if (score > 512) score = 512 - (score - 512) * 0.1;
    if (isRaster(i)) score += 1e3;
    if (/maskable/i.test(i.purpose || "")) score -= 200;
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].i;
}
function slugAppId(url) {
  let host = "app";
  let pathPart = "";
  try {
    const u = new URL(String(url || ""));
    host = u.hostname.replace(/^www\./, "").toLowerCase() || "app";
    pathPart = u.pathname;
  } catch {
  }
  const pathSlug = pathPart.split("/").filter(Boolean).map((p) => p.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).slice(0, 2).join("-") || "";
  const id = pathSlug ? `${host}-${pathSlug}` : host;
  return id.slice(0, 96).replace(/[^a-z0-9._-]/gi, "") || "app";
}
function parseAppArg(argv) {
  const list = Array.isArray(argv) ? argv : [];
  const m = list.find((a) => /^--aether-app=[A-Za-z0-9._-]+$/.test(String(a || "")));
  return m ? String(m).split("=")[1] : null;
}
export {
  parseAppArg,
  parseIconSizes,
  parseManifestJson,
  parseManifestLink,
  pickIcon,
  resolveUrl,
  slugAppId
};
