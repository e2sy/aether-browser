/**
 * Mouse gestures preload (v2.8.0) — plain JS, NOT bundled (runs import-free
 * inside sandboxed frames, copied verbatim to out/preload/gesture.js by the
 * vite config next to farble.js).
 *
 * Detection: press right button → accumulate the drag trail → on release,
 * collapse it into cardinal directions (30px threshold per segment, dominant
 * axis wins) → tell the main process. A drag that forms a recognized shape
 * swallows the native context menu; a plain right-click passes through
 * untouched.
 *
 * The toggle lives in main (settings.gestures) and is read once per page
 * load via a synchronous config round-trip — the same mechanism farble.js
 * uses — so flipping the setting never needs a restart.
 */
;(function () {
  'use strict'
  if (window.__AETHER_GESTURE__) return

  var THRESHOLD = 30
  var MAX_LEN = 3

  var config = { enabled: true }
  try {
    if (typeof process !== 'undefined' && process.env && process.env.AETHER_GESTURE_TEST_CONFIG) {
      config = JSON.parse(process.env.AETHER_GESTURE_TEST_CONFIG)
    } else {
      config = require('electron').ipcRenderer.sendSync('aether:gesture-config')
    }
  } catch (e) {
    config = { enabled: false } /* bridge down — never hijack right-click */
  }

  // indirection so the node test harness can observe/intercept the send
  var _emit = function (payload) {
    require('electron').ipcRenderer.send('aether:gesture', payload)
  }

  if (config && config.enabled) {
    var tracking = false
    var trail = []
    var suppressMenu = false

    var collapseSeq = function () {
      var dirs = []
      if (trail.length < 2) return ''
      var ax = trail[0].x
      var ay = trail[0].y
      for (var i = 1; i < trail.length; i++) {
        var dx = trail[i].x - ax
        var dy = trail[i].y - ay
        if (Math.abs(dx) >= THRESHOLD || Math.abs(dy) >= THRESHOLD) {
          if (Math.abs(dx) >= Math.abs(dy)) dirs.push(dx > 0 ? 'R' : 'L')
          else dirs.push(dy > 0 ? 'D' : 'U')
          if (dirs.length >= MAX_LEN) return dirs.join('')
          ax = trail[i].x
          ay = trail[i].y
        }
      }
      return dirs.join('')
    }

    window.addEventListener(
      'mousedown',
      function (e) {
        try {
          if (e.button !== 2) return
          tracking = true
          trail = [{ x: e.clientX, y: e.clientY }]
        } catch (err) {
          /* never break the page */
        }
      },
      true
    )

    window.addEventListener(
      'mousemove',
      function (e) {
        try {
          if (!tracking) return
          trail.push({ x: e.clientX, y: e.clientY })
          if (trail.length > 400) trail.shift()
        } catch (err) {
          /* never break the page */
        }
      },
      true
    )

    window.addEventListener(
      'mouseup',
      function (e) {
        try {
          if (!tracking || e.button !== 2) return
          tracking = false
          trail.push({ x: e.clientX, y: e.clientY })
          var seq = collapseSeq()
          if (!seq) return
          suppressMenu = true
          setTimeout(function () {
            suppressMenu = false
          }, 350)
          _emit({ seq: seq, trail: trail.slice() })
        } catch (err) {
          tracking = false
        }
      },
      true
    )

    // a drag that formed a shape is a gesture, not a context-menu request
    window.addEventListener(
      'contextmenu',
      function (e) {
        try {
          if (suppressMenu) {
            suppressMenu = false /* strictly one-shot */
            e.preventDefault()
            e.stopPropagation()
          }
        } catch (err) {
          /* cosmetic */
        }
      },
      true
    )

    window.__AETHER_GESTURE__ = { version: 1 }
  }

  // ---- test hook: expose the detector when loaded under node's require ----
  if (
    typeof module !== 'undefined' &&
    module.exports !== undefined &&
    typeof process !== 'undefined' &&
    process.env &&
    process.env.AETHER_GESTURE_TEST
  ) {
    module.exports = {
      collapse: collapseSeq,
      listeners: typeof window.__aetherTestListeners === 'function' ? window.__aetherTestListeners() : {},
      installed: !!window.__AETHER_GESTURE__,
      enabled: !!(config && config.enabled),
      _setEmitter: function (fn) {
        _emit = fn
      },
      _state: function () {
        return { tracking: tracking, suppressMenu: suppressMenu, trailLen: trail.length }
      }
    }
  }
})()
