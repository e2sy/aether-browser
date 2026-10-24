/**
 * Post-build sandbox patch for out/preload/index.js.
 *
 * Electron's sandboxed preload can only require("electron") — requiring the
 * node builtin `events` throws "module not found" (still true in Electron 45)
 * and kills the entire preload, leaving window.aether undefined and the whole
 * browser UI dead. electron-vite externalizes node builtins before user
 * plugins/aliases can intercept, so this script inlines a minimal
 * EventEmitter shim wherever the bundle still says require("events").
 *
 * Wired into `npm run build` after electron-vite build. Idempotent.
 * Run:  node scripts/patch-preload-sandbox.cjs
 */
import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'out', 'preload', 'index.js')

if (!fs.existsSync(file)) {
  console.error('[patch-preload] ERROR: out/preload/index.js not found — run electron-vite build first')
  process.exit(1)
}

let src = fs.readFileSync(file, 'utf8')

const NEEDS = /require\(\s*["'](node:)?events["']\s*\)/.test(src)
const PATCHED = src.includes('__aetherEventsShim')

if (!NEEDS && PATCHED) {
  console.log('[patch-preload] already patched, nothing to do')
  process.exit(0)
}

if (!NEEDS) {
  console.log('[patch-preload] bundle has no require("events") — nothing to do')
  process.exit(0)
}

const SHIM = `/* sandbox-safe EventEmitter shim (inlined by patch-preload-sandbox.cjs) */
function __aetherEventsShim() {
  function EventEmitter() { this._events = Object.create(null) }
  EventEmitter.prototype.on = function (n, f) { (this._events[n] || (this._events[n] = [])).push(f); return this }
  EventEmitter.prototype.addListener = EventEmitter.prototype.on
  EventEmitter.prototype.once = function (n, f) {
    var g = function () { this.removeListener(n, g); f.apply(this, arguments) }
    g._orig = f
    return this.on(n, g)
  }
  EventEmitter.prototype.removeListener = function (n, f) {
    var l = this._events[n]
    if (!l) return this
    var i = l.findIndex(function (h) { return h === f || h._orig === f })
    if (i >= 0) l.splice(i, 1)
    return this
  }
  EventEmitter.prototype.off = EventEmitter.prototype.removeListener
  EventEmitter.prototype.removeAllListeners = function (n) {
    if (n === undefined) this._events = Object.create(null)
    else delete this._events[n]
    return this
  }
  EventEmitter.prototype.emit = function (n) {
    var l = this._events[n]
    if (!l || !l.length) return false
    var a = Array.prototype.slice.call(arguments, 1)
    for (var i = 0; i < l.length; i++) l[i].apply(this, a)
    return true
  }
  EventEmitter.prototype.listenerCount = function (n) { return (this._events[n] || []).length }
  EventEmitter.prototype.setMaxListeners = function () { return this }
  EventEmitter.EventEmitter = EventEmitter
  EventEmitter.defaultMaxListeners = 10
  return EventEmitter
}
var __aetherEvents = __aetherEventsShim()
/* end shim */
`

// replace every require("events") / require('events') / node:events with the shim
let count = 0
src = src.replace(/require\(\s*["'](node:)?events["']\s*\)/g, () => {
  count++
  return '__aetherEvents'
})

src = SHIM + src
fs.writeFileSync(file, src)

const leftover = /require\(\s*["'](node:)?events["']\s*\)/.test(src)
const onlyElectron = Array.from(src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)).map((m) => m[1])
const nonElectron = [...new Set(onlyElectron.filter((r) => r !== 'electron'))]

console.log(`[patch-preload] replaced ${count} require("events") call(s) with the inline shim`)
if (leftover) {
  console.error('[patch-preload] ERROR: require("events") still present after patch')
  process.exit(1)
}
console.log('[patch-preload] remaining external requires:', nonElectron.length ? nonElectron.join(', ') : 'none (electron only)')
if (nonElectron.some((r) => !r.startsWith('./') && !r.startsWith('../') && r !== 'events')) {
  console.error('[patch-preload] ERROR: sandbox-breaking external require(s) found: ' + nonElectron.join(', '))
  process.exit(1)
}
console.log('[patch-preload] OK — preload is sandbox-safe')
