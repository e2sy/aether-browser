// src/shared/fuzzy.ts
var BOUNDARY_CHARS = /* @__PURE__ */ new Set([" ", "-", "_", ".", "/", ":", "(", ")", "[", "]"]);
function fuzzyMatch(query, target) {
  const q = String(query || "").toLowerCase();
  const t = String(target || "").toLowerCase();
  if (!q) return { score: 0, positions: [] };
  if (!t) return null;
  const positions = [];
  let score = 0;
  let ti = 0;
  let run = 0;
  let firstIdx = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === " ") {
      run = 0;
      continue;
    }
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === c) {
        found = j;
        break;
      }
    }
    if (found < 0) return null;
    let gain = 1;
    if (found > 0 && BOUNDARY_CHARS.has(t[found - 1])) gain += 6;
    else if (found > 0 && t[found - 1] !== t[found - 1].toUpperCase() && t[found] === t[found].toUpperCase()) gain += 5;
    if (found === 0) gain += 8;
    run = found === (positions.length ? positions[positions.length - 1] + 1 : found) && run > 0 ? run + 1 : 1;
    if (run > 1) gain += 2 + Math.min(run, 6);
    const gap = positions.length ? found - positions[positions.length - 1] - 1 : found;
    gain -= Math.min(gap, 10) * 0.4;
    score += gain;
    positions.push(found);
    ti = found + 1;
    if (firstIdx < 0) firstIdx = found;
  }
  return { score, positions };
}

// src/shared/tabsearch.ts
function hostOfTab(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function rankTabs(query, tabs, activeId = null, limit = 20) {
  const list = Array.isArray(tabs) ? tabs : [];
  const q = String(query || "").trim();
  if (!q) {
    const ordered = [...list].sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      return 0;
    });
    return ordered.slice(0, limit).map((tab) => ({ tab, score: 0 }));
  }
  const out = [];
  for (const tab of list) {
    const title = String(tab.title || "");
    const url = String(tab.url || "");
    const host = hostOfTab(url);
    const mTitle = fuzzyMatch(q, title);
    const mUrl = fuzzyMatch(q, url);
    const mHost = host ? fuzzyMatch(q, host) : null;
    let score = -1;
    if (mTitle) score = Math.max(score, mTitle.score + 6);
    if (mUrl) score = Math.max(score, mUrl.score);
    if (mHost) score = Math.max(score, mHost.score + 10);
    if (score < 0) continue;
    if (tab.id === activeId) score += 2;
    if (tab.pinned) score += 1;
    out.push({ tab, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
export {
  hostOfTab,
  rankTabs
};
