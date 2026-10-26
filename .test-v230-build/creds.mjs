// src/shared/creds.ts
function normalizeHost(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
function passwordStrength(pw) {
  const p = String(pw || "");
  if (!p) return { score: 0, label: "empty" };
  let classes = 0;
  if (/[a-z]/.test(p)) classes++;
  if (/[A-Z]/.test(p)) classes++;
  if (/[0-9]/.test(p)) classes++;
  if (/[^A-Za-z0-9]/.test(p)) classes++;
  const uniq = new Set(p).size;
  let score = 0;
  if (p.length >= 8) score = 1;
  if (p.length >= 10 && classes >= 2 && uniq >= 6) score = 2;
  if (p.length >= 12 && classes >= 3 && uniq >= 8) score = 3;
  if (p.length >= 16 && classes >= 3 && uniq >= 10) score = 4;
  if (p.length >= 16 && uniq >= 10) score = Math.max(score, 3);
  const labels = ["very weak", "weak", "fair", "strong", "excellent"];
  return { score, label: labels[score] };
}
var LOWER = "abcdefghijklmnopqrstuvwxyz";
var UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
var DIGIT = "0123456789";
var SYMBOL = "!@#$%^&*()-_=+[]{};:,.?";
var AMBIGUOUS = /* @__PURE__ */ new Set(["l", "I", "1", "O", "0", "`", "'", '"']);
function generatePassword(length = 20, rng = Math.random) {
  const len = Math.max(8, Math.min(96, Math.floor(length) || 20));
  const pools = [LOWER, UPPER, DIGIT, SYMBOL].map((pool) => [...pool].filter((c) => !AMBIGUOUS.has(c)));
  const all = pools.flat();
  const picks = pools.map((pool) => pool[Math.floor(rng() * pool.length)]);
  while (picks.length < len) picks.push(all[Math.floor(rng() * all.length)]);
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.slice(0, len).join("");
}
function pickLoginFields(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  let passwordIdx = -1;
  for (let i = 0; i < list.length; i++) {
    if (String(list[i]?.type || "").toLowerCase() === "password") {
      passwordIdx = i;
      break;
    }
  }
  if (passwordIdx < 0) return { passwordIdx: -1, usernameIdx: -1 };
  let usernameIdx = -1;
  for (let i = passwordIdx - 1; i >= 0; i--) {
    const t = String(list[i]?.type || "").toLowerCase();
    if (t === "text" || t === "email" || t === "tel" || t === "" || t === "hidden") {
      const hint = String(list[i]?.hint || "").toLowerCase();
      if (/search|query|filter|q\b/.test(hint)) continue;
      usernameIdx = i;
      break;
    }
  }
  return { passwordIdx, usernameIdx };
}
var USER_MAX = 128;
var PASS_MAX = 256;
function sanitizeCred(value, max = PASS_MAX) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function sanitizeUsername(value) {
  return sanitizeCred(value, USER_MAX);
}
function sanitizePassword(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, PASS_MAX);
}
function matchCreds(records, url) {
  const host = normalizeHost(url);
  if (!host) return null;
  const hits = (Array.isArray(records) ? records : []).filter((r) => r && r.host === host);
  if (!hits.length) return null;
  return hits.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
}
function buildFillScript(username, password) {
  const u = JSON.stringify(String(username || ""));
  const p = JSON.stringify(String(password || ""));
  return `(function () {
  try {
    var forms = document.querySelectorAll('form')
    var form = null
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('input[type=password]')) { form = forms[i]; break }
    }
    if (!form) return 0
    var inputs = Array.prototype.slice.call(form.querySelectorAll('input'))
    var pi = -1
    for (var j = 0; j < inputs.length; j++) {
      if ((inputs[j].getAttribute('type') || 'text').toLowerCase() === 'password') { pi = j; break }
    }
    if (pi < 0) return 0
    var ui = -1
    for (var k = pi - 1; k >= 0; k--) {
      var t = (inputs[k].getAttribute('type') || 'text').toLowerCase()
      if (t === 'text' || t === 'email' || t === 'tel') { ui = k; break }
    }
    function set(el, val) {
      if (!el) return
      var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      var desc = Object.getOwnPropertyDescriptor(proto, 'value')
      if (desc && desc.set) desc.set.call(el, val)
      else el.value = val
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    set(ui >= 0 ? inputs[ui] : null, ${u})
    set(inputs[pi], ${p})
    return pi >= 0 ? 1 : 0
  } catch (err) { return 0 }
})()`;
}
var SUBMIT_HOOK_SCRIPT = `(function () {
  try {
    if (window.__aetherCredHook) return 0
    window.__aetherCredHook = true
    function grab(form) {
      try {
        var inputs = Array.prototype.slice.call(form.querySelectorAll('input'))
        var pi = -1
        for (var i = 0; i < inputs.length; i++) {
          if ((inputs[i].getAttribute('type') || 'text').toLowerCase() === 'password') { pi = i; break }
        }
        if (pi < 0) return null
        var pw = inputs[pi].value || ''
        if (!pw) return null
        var ui = -1
        for (var k = pi - 1; k >= 0; k--) {
          var t = (inputs[k].getAttribute('type') || 'text').toLowerCase()
          if (t === 'text' || t === 'email' || t === 'tel') { ui = k; break }
        }
        var user = ui >= 0 ? (inputs[ui].value || '') : ''
        return { username: String(user).slice(0, 128), password: String(pw).slice(0, 256) }
      } catch (err) { return null }
    }
    function report(form) {
      var cred = grab(form)
      if (!cred) return
      try {
        if (window.aether && window.aether.creds && window.aether.creds.submit) {
          window.aether.creds.submit(cred)
        }
      } catch (err) { /* never break the page */ }
    }
    document.addEventListener('submit', function (e) {
      try {
        var f = e.target
        if (f && f.querySelectorAll && f.querySelector('input[type=password]')) report(f)
      } catch (err) { /* noop */ }
    }, true)
    return 1
  } catch (err) { return 0 }
})()`;
var PROBE_SCRIPT = `(function () {
  try {
    function scan(form) {
      var inputs = Array.prototype.slice.call(form.querySelectorAll('input'))
      var pi = -1
      for (var i = 0; i < inputs.length; i++) {
        if ((inputs[i].getAttribute('type') || 'text').toLowerCase() === 'password') { pi = i; break }
      }
      if (pi < 0) return null
      var ui = -1
      for (var k = pi - 1; k >= 0; k--) {
        var t = (inputs[k].getAttribute('type') || 'text').toLowerCase()
        if (t === 'text' || t === 'email' || t === 'tel') { ui = k; break }
      }
      return {
        username: String(ui >= 0 ? inputs[ui].value || '' : '').slice(0, 128),
        password: String(inputs[pi].value || '').slice(0, 256)
      }
    }
    var el = document.activeElement
    if (el && el.form) {
      var hit = scan(el.form)
      if (hit && hit.password) return hit
    }
    var forms = document.querySelectorAll('form')
    for (var i = 0; i < forms.length; i++) {
      var hit2 = scan(forms[i])
      if (hit2 && hit2.password) return hit2
    }
    return null
  } catch (err) { return null }
})()`;
function buildGenerateScript(password) {
  const p = JSON.stringify(String(password || ""));
  return `(function () {
  try {
    var el = document.activeElement
    var target = null
    if (el && (el.tagName || '').toLowerCase() === 'input' && (el.getAttribute('type') || 'text').toLowerCase() === 'password') {
      target = el
    } else {
      var forms = document.querySelectorAll('form')
      for (var i = 0; i < forms.length && !target; i++) {
        var inputs = forms[i].querySelectorAll('input')
        for (var j = 0; j < inputs.length; j++) {
          if ((inputs[j].getAttribute('type') || 'text').toLowerCase() === 'password') { target = inputs[j]; break }
        }
      }
    }
    if (!target) return 0
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (desc && desc.set) desc.set.call(target, ${p})
    else target.value = ${p}
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return 1
  } catch (err) { return 0 }
})()`;
}
export {
  PROBE_SCRIPT,
  SUBMIT_HOOK_SCRIPT,
  buildFillScript,
  buildGenerateScript,
  generatePassword,
  matchCreds,
  normalizeHost,
  passwordStrength,
  pickLoginFields,
  sanitizeCred,
  sanitizePassword,
  sanitizeUsername
};
