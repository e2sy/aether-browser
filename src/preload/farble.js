/**
 * AETHER FARBLE (v2.7.0 build 21) — Brave-style fingerprint farbling.
 *
 * A session-level preload (registered via session.setPreloads, same mechanism
 * the shields cosmetic engine uses) that runs BEFORE page scripts in every
 * frame of its session and re-writes the APIs most abused for fingerprinting:
 *
 *   canvas 2D      — getImageData / toDataURL / toBlob get deterministic noise
 *   WebGL          — UNMASKED vendor/renderer report a believable pool GPU;
 *                    readPixels gets the same deterministic noise
 *   Audio          — AudioBuffer.getChannelData gets ±1e-7 noise (once/buffer)
 *   hardware       — navigator.hardwareConcurrency / deviceMemory rounded
 *   timezone       — Date.getTimezoneOffset + Intl resolvedOptions report the
 *                    configured zone (proxied containers — IP↔tz consistency)
 *
 * Brave "farbling" contract: readings differ per SITE (seed = host + a
 * random per-boot salt) but stay STABLE within the session — pages keep
 * working, trackers can't link sites. The seed math mirrors shared/farble.ts.
 *
 * Sandbox-safe: plain browser APIs + require('electron') only. Every patch
 * is individually try/catch-wrapped — farbling must never break a page.
 * When mode !== 'standard' this file does NOTHING (single config round-trip).
 */
;(function () {
  'use strict'
  if (typeof window === 'undefined' || !window.top) return
  if (window.__AETHER_FARBLE__) return // double-preload guard (iframes)

  // ---- config (one synchronous round-trip; main answers per-sender) ----
  var config = { mode: 'off', timezone: '', salt: '' }
  try {
    if (typeof process !== 'undefined' && process.env && process.env.AETHER_FARBLE_TEST_CONFIG) {
      config = JSON.parse(process.env.AETHER_FARBLE_TEST_CONFIG)
    } else if (typeof require === 'function') {
      var er = require('electron')
      if (er && er.ipcRenderer) {
        var answer = er.ipcRenderer.sendSync('aether:farble-config')
        if (answer && typeof answer === 'object') config = answer
      }
    }
  } catch (e) {
    config = { mode: 'off', timezone: '', salt: '' }
  }
  if (config.mode !== 'standard') return // self-gate: opt-in behavior, zero risk

  // ---- seed math (mirrors src/shared/farble.ts) ----
  function fnv1a(str) {
    var h = 0x811c9dc5
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
  }
  var HOST = ''
  try {
    HOST = String(location.hostname || '').toLowerCase()
  } catch (e) {
    HOST = ''
  }
  var SEED = fnv1a(HOST + '|' + String(config.salt || ''))
  var STRIDE = 253 // prime — spreads noise across buffers (shared/farble.ts)
  function noiseAt(index) {
    var h = fnv1a(String(SEED) + ':' + String(index | 0))
    h = fnv1a(String(h) + 'n')
    return (h % 3) - 1 // -1 | 0 | 1
  }
  function pickFrom(pool) {
    return pool[Math.abs(SEED) % pool.length]
  }

  var HW_POOL = [2, 4, 6, 8, 12, 16]
  var MEM_POOL = [2, 4, 8]
  var GPU_POOL = [
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)']
  ]
  var GPU = pickFrom(GPU_POOL)
  var HW = pickFrom(HW_POOL)
  var MEM = pickFrom(MEM_POOL)

  var applied = []

  // ---------- canvas ----------
  try {
    var proto = HTMLCanvasElement.prototype
    var origToDataURL = proto.toDataURL
    var origToBlob = proto.toBlob
    var ctxProto = (function () {
      try {
        var probe = document.createElement('canvas')
        return probe.getContext('2d') && CanvasRenderingContext2D.prototype
      } catch (e) {
        return null
      }
    })()
    var origGetImageData = ctxProto ? ctxProto.getImageData : null

    /** Deterministically nudge a copy of the canvas's pixels. */
    function farbledClone(canvas) {
      if (!origGetImageData) return canvas
      var w = canvas.width
      var h = canvas.height
      if (!w || !h) return canvas
      var out = document.createElement('canvas')
      out.width = w
      out.height = h
      var octx = out.getContext('2d')
      if (!octx) return canvas
      octx.drawImage(canvas, 0, 0)
      var img = origGetImageData.call(octx, 0, 0, w, h)
      var d = img.data
      for (var i = 0; i < d.length; i += STRIDE * 4) {
        d[i] = d[i] + noiseAt(i) // red channel only — invisible, deterministic
      }
      octx.putImageData(img, 0, 0)
      return out
    }

    proto.toDataURL = function () {
      try {
        return origToDataURL.apply(farbledClone(this), arguments)
      } catch (e) {
        return origToDataURL.apply(this, arguments)
      }
    }
    proto.toBlob = function (cb) {
      var rest = Array.prototype.slice.call(arguments, 1)
      try {
        return origToBlob.apply(farbledClone(this), [cb].concat(rest))
      } catch (e) {
        return origToBlob.apply(this, arguments)
      }
    }
    if (ctxProto && origGetImageData) {
      ctxProto.getImageData = function (sx, sy, sw, sh) {
        var img = origGetImageData.call(this, sx, sy, sw, sh)
        try {
          var d = img.data
          for (var i = 0; i < d.length; i += STRIDE * 4) d[i] = d[i] + noiseAt(i + sx * 4 + sy * sw * 4)
          return img
        } catch (e) {
          return img
        }
      }
    }
    applied.push('canvas')
  } catch (e) {
    /* canvas farbling unavailable */
  }

  // ---------- WebGL ----------
  try {
    var WEBGL_VENDOR = 37445
    var WEBGL_RENDERER = 37446
    function patchGl(proto) {
      if (!proto) return
      var origGetParameter = proto.getParameter
      proto.getParameter = function (p) {
        if (p === WEBGL_VENDOR) return GPU[0]
        if (p === WEBGL_RENDERER) return GPU[1]
        return origGetParameter.call(this, p)
      }
      if (proto.readPixels) {
        var origReadPixels = proto.readPixels
        proto.readPixels = function (x, y, w, h, fmt, type, pixels) {
          var r = origReadPixels.apply(this, arguments)
          try {
            if (pixels && pixels.length && typeof pixels[0] === 'number') {
              for (var i = 0; i < pixels.length; i += STRIDE * 4) {
                pixels[i] = Math.max(0, Math.min(255, pixels[i] + noiseAt(i + x + y * w)))
              }
            }
          } catch (e) {
            /* noise is best-effort */
          }
          return r
        }
      }
    }
    if (typeof WebGLRenderingContext !== 'undefined') patchGl(WebGLRenderingContext.prototype)
    if (typeof WebGL2RenderingContext !== 'undefined') patchGl(WebGL2RenderingContext.prototype)
    applied.push('webgl')
  } catch (e) {
    /* webgl farbling unavailable */
  }

  // ---------- audio ----------
  try {
    if (typeof AudioBuffer !== 'undefined' && AudioBuffer.prototype.getChannelData) {
      var origGetChannelData = AudioBuffer.prototype.getChannelData
      var noised = typeof WeakSet === 'function' ? new WeakSet() : null
      AudioBuffer.prototype.getChannelData = function (ch) {
        var data = origGetChannelData.call(this, ch)
        try {
          if (noised) {
            if (noised.has(data)) return data
            noised.add(data)
          }
          for (var i = 0; i < data.length; i += STRIDE) {
            data[i] = data[i] + noiseAt(i + ch) * 1e-7
          }
          return data
        } catch (e) {
          return data
        }
      }
      applied.push('audio')
    }
  } catch (e) {
    /* audio farbling unavailable */
  }

  // ---------- hardware ----------
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: function () { return HW }, configurable: true })
    if ('deviceMemory' in navigator) {
      Object.defineProperty(navigator, 'deviceMemory', { get: function () { return MEM }, configurable: true })
    }
    applied.push('hardware')
  } catch (e) {
    /* hardware farbling unavailable */
  }

  // ---------- timezone (proxied containers) ----------
  if (config.timezone) {
    try {
      var TZ = String(config.timezone)
      var offsetCache = {}
      function zoneOffsetMinutes(t) {
        // (UTC - zone) in minutes at instant t — cached per 10-min bucket
        var bucket = Math.floor(t / 600000)
        var key = String(bucket)
        if (offsetCache[key] !== undefined) return offsetCache[key]
        var dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: TZ,
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
        var map = {}
        var parts = dtf.formatToParts(new Date(t))
        for (var i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value
        var asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute), Number(map.second))
        var off = Math.round((asUTC - t) / 60000)
        if (Object.keys(offsetCache).length > 512) offsetCache = {}
        offsetCache[key] = off
        return off
      }
      Date.prototype.getTimezoneOffset = function () {
        try {
          return -zoneOffsetMinutes(this.getTime())
        } catch (e) {
          return 0
        }
      }
      var origResolved = Intl.DateTimeFormat.prototype.resolvedOptions
      Intl.DateTimeFormat.prototype.resolvedOptions = function () {
        var opts = origResolved.call(this)
        try {
          if (!opts || !opts.timeZone) return opts
          // report the spoofed zone; formatting behavior of THIS formatter
          // is untouched (callers asked us what zone we are in)
          var clone = {}
          for (var k in opts) clone[k] = opts[k]
          clone.timeZone = TZ
          return clone
        } catch (e) {
          return opts
        }
      }
      applied.push('timezone')
    } catch (e) {
      /* timezone spoofing unavailable */
    }
  }

  if (applied.length) {
    window.__AETHER_FARBLE__ = { seed: SEED, applied: applied, timezone: config.timezone || '' }
  }

  // ---- test hook: expose the pure math when loaded under node's require ----
  if (typeof module !== 'undefined' && module.exports !== undefined && typeof process !== 'undefined' && process.env && process.env.AETHER_FARBLE_TEST) {
    module.exports = { fnv1a: fnv1a, seed: SEED, host: HOST, applied: applied, noiseAt: noiseAt, pickFrom: pickFrom }
  }
})()
