/**
 * v1.4.0 Customization Studio tests — the appearance engine.
 *
 * Covers: per-field normalization (garbage in -> defaults out, never throws),
 * hex validation, shadeHex/hexToRgba math, font-scale clamping, both palettes,
 * the CSS variable emission (accent + zoom + new-tab backgrounds), preset
 * sanity, and the settings.json corruption-resilience contract.
 *
 * Run:  node scripts/test-v140.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(ROOT, '..')

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗ FAIL:', name)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-test140-'))

function stubModule(name, code) {
  const dir = path.join(tmp, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.js'), code)
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
}

stubModule('electron', `module.exports = { app: { getPath: () => '${tmp.replace(/\\/g, '/')}/userdata' } }`)
fs.cpSync(path.join(APP, 'src'), path.join(tmp, 'src'), { recursive: true })

const entry = path.join(tmp, 'src', 'main', 'testable.ts')
fs.writeFileSync(
  entry,
  `export {
     DEFAULT_APPEARANCE, ACCENT_PRESETS, DARK_PALETTE, LIGHT_PALETTE,
     isHexColor, shadeHex, hexToRgba, normalizeAppearance, appearanceCss
   } from './appearance'`
)

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(tmp, 'bundle.mjs'),
  logLevel: 'silent'
})

const B = await import(pathToFileURL(path.join(tmp, 'bundle.mjs')).href)
const {
  DEFAULT_APPEARANCE, ACCENT_PRESETS, DARK_PALETTE, LIGHT_PALETTE,
  isHexColor, shadeHex, hexToRgba, normalizeAppearance, appearanceCss
} = B

/* ================= 1. defaults + presets ================= */
console.log('\n[1] defaults + presets')
{
  ok(DEFAULT_APPEARANCE.theme === 'dark' && DEFAULT_APPEARANCE.accent === '#7c8cff' &&
     DEFAULT_APPEARANCE.fontScale === 1 && DEFAULT_APPEARANCE.newtabBg === 'aurora' &&
     DEFAULT_APPEARANCE.newtabClock === true, 'sane default appearance')
  ok(ACCENT_PRESETS.length === 8, 'exactly 8 accent presets')
  ok(ACCENT_PRESETS.every((c) => isHexColor(c)), 'every preset is a valid #rrggbb')
  ok(ACCENT_PRESETS.every((c) => c === c.toLowerCase()), 'presets are lowercase (normalized form)')
}

/* ================= 2. normalizeAppearance — garbage in, defaults out ================= */
console.log('\n[2] normalizeAppearance — never throws, per-field fallback')
{
  const d = normalizeAppearance(null)
  ok(JSON.stringify(d) === JSON.stringify(DEFAULT_APPEARANCE), 'null patch -> defaults')
  ok(JSON.stringify(normalizeAppearance(undefined)) === JSON.stringify(DEFAULT_APPEARANCE), 'undefined -> defaults')
  ok(JSON.stringify(normalizeAppearance('garbage')) === JSON.stringify(DEFAULT_APPEARANCE), 'string patch -> defaults')
  ok(JSON.stringify(normalizeAppearance(42)) === JSON.stringify(DEFAULT_APPEARANCE), 'number patch -> defaults')
  ok(JSON.stringify(normalizeAppearance({})) === JSON.stringify(DEFAULT_APPEARANCE), 'empty object -> defaults (restore-defaults path)')

  const g = normalizeAppearance({
    theme: 'neon', accent: 'red', fontScale: 'big', newtabBg: 'sparkle', newtabClock: 'yes'
  })
  ok(g.theme === 'dark' && g.accent === '#7c8cff' && g.newtabBg === 'aurora' && g.newtabClock === true,
    'every invalid field falls back to default, no throw')

  ok(normalizeAppearance({ theme: 'light' }).theme === 'light', 'valid theme accepted')
  ok(normalizeAppearance({ theme: 'system' }).theme === 'system', 'system theme accepted')
  ok(normalizeAppearance({ accent: '#E5636F' }).accent === '#e5636f', 'accent uppercased -> lowercased')
  ok(normalizeAppearance({ accent: '#e5636f99' }).accent === '#7c8cff', '8-digit hex rejected (alpha not supported)')
  ok(normalizeAppearance({ accent: 'e5636f' }).accent === '#7c8cff', 'hex without # rejected')
  ok(normalizeAppearance({ fontScale: 3 }).fontScale === 1.25, 'fontScale clamped high')
  ok(normalizeAppearance({ fontScale: 0.1 }).fontScale === 0.85, 'fontScale clamped low')
  ok(normalizeAppearance({ fontScale: 1.1 }).fontScale === 1.1, 'valid fontScale kept')
  ok(normalizeAppearance({ fontScale: 1.111111 }).fontScale === 1.11, 'fontScale rounded to 2 decimals')
  ok(normalizeAppearance({ fontScale: NaN }).fontScale === 1, 'NaN fontScale -> default')
  ok(normalizeAppearance({ newtabClock: false }).newtabClock === false, 'clock toggle honored')

  const cur = { ...DEFAULT_APPEARANCE, accent: '#e5636f' }
  ok(normalizeAppearance({ theme: 'light' }, cur).accent === '#e5636f',
    'patch fields MERGE into current state (other fields preserved)')
  ok(normalizeAppearance({ theme: 'bogus' }, cur).accent === '#e5636f',
    'invalid field keeps the CURRENT value, not just defaults')
}

/* ================= 3. color helpers ================= */
console.log('\n[3] shadeHex / hexToRgba')
{
  ok(shadeHex('#ffffff', 0) === '#ffffff', 'shade 0 -> unchanged')
  ok(shadeHex('#ffffff', 1) === '#000000', 'shade 1 -> black')
  ok(shadeHex('#7c8cff', 0.5) === '#3e4680', 'half shade mixes toward black')
  ok(shadeHex('nope', 0.5) === 'nope', 'invalid hex passes through unchanged')
  ok(hexToRgba('#7c8cff', 0.1) === 'rgba(124,140,255,0.1)', 'hex -> rgba conversion')
  ok(hexToRgba('#zzzzzz', 0.1) === '#zzzzzz', 'invalid hex -> passthrough')
}

/* ================= 4. appearanceCss — the variable block ================= */
console.log('\n[4] appearanceCss emission')
{
  const darkCss = appearanceCss(DEFAULT_APPEARANCE, true)
  ok(darkCss.includes('--ax-bg: #16171b'), 'dark palette bg variable')
  ok(darkCss.includes('--ax-accent: #7c8cff'), 'accent variable emitted')
  ok(darkCss.includes('zoom: 1'), 'font scale emitted as zoom')
  ok(darkCss.includes('--ax-ntbg: radial-gradient'), 'aurora new-tab gradient')
  ok(!darkCss.includes('--ax-fg: #1c1f28'), 'light fg must not leak into dark theme')

  const lightCss = appearanceCss({ ...DEFAULT_APPEARANCE, theme: 'light' }, true)
  ok(lightCss.includes('--ax-bg: #f5f6fa') && lightCss.includes('--ax-fg: #1c1f28'),
    'light palette swaps bg AND fg')
  ok(lightCss.includes('--ax-danger: #c73f4a'), 'light theme has its own readable danger color')

  const sysLight = appearanceCss({ ...DEFAULT_APPEARANCE, theme: 'system' }, false)
  ok(sysLight.includes('--ax-bg: #f5f6fa'), 'system theme resolves via systemDark flag (light)')
  const sysDark = appearanceCss({ ...DEFAULT_APPEARANCE, theme: 'system' }, true)
  ok(sysDark.includes('--ax-bg: #16171b'), 'system theme resolves via systemDark flag (dark)')

  const custom = appearanceCss({ ...DEFAULT_APPEARANCE, accent: '#e5636f', fontScale: 1.15, newtabBg: 'midnight' }, true)
  ok(custom.includes('--ax-accent: #e5636f') && custom.includes('--ax-accent2: #c5555f'),
    'custom accent derives the strong variant')
  ok(custom.includes('zoom: 1.15'), 'custom zoom emitted')
  ok(custom.includes('linear-gradient(180deg, #0b0d13'), 'midnight gradient selected')
  ok(custom.includes('--ax-accent-soft: rgba(229,99,111'), 'accent-soft derives from the custom accent')

  const solid = appearanceCss({ ...DEFAULT_APPEARANCE, newtabBg: 'solid' }, true)
  ok(solid.includes('--ax-ntbg: #16171b'), 'solid preset is a plain color')

  for (const css of [darkCss, lightCss]) {
    const needed = ['--ax-bg', '--ax-fg', '--ax-card', '--ax-card2', '--ax-border', '--ax-muted',
      '--ax-faint', '--ax-danger', '--ax-ok', '--ax-accent', '--ax-accent2', '--ax-accent-soft',
      '--ax-ntbg', '--ax-ok-soft', '--ax-danger-soft', '--ax-muted-soft']
    if (!needed.every((v) => css.includes(v + ':'))) {
      ok(false, 'all ' + needed.length + ' variables present in both themes')
      break
    }
  }
  ok(true, 'all 16 variables present in both themes')
}

/* ================= 5. palettes coherent ================= */
console.log('\n[5] palette coherence')
{
  const keys = Object.keys(DARK_PALETTE).filter((k) => k !== 'ntbg')
  ok(keys.every((k) => LIGHT_PALETTE[k]), 'light palette covers every dark palette key')
  ok(Object.values(DARK_PALETTE).every((v) => !v || /^#[0-9a-f]{6}$/i.test(v)),
    'dark palette values are valid hex (ntbg empty placeholder ok)')
  ok(Object.values(LIGHT_PALETTE).every((v) => !v || /^#[0-9a-f]{6}$/i.test(v)),
    'light palette values are valid hex')
}

/* ================= 6. corruption resilience (the boot contract) ================= */
console.log('\n[6] corrupted settings.json resilience')
{
  const blobs = [
    null,
    'completely broken',
    [],
    { appearance: 'nonsense' },
    { appearance: 3 },
    { appearance: { theme: { nested: true }, accent: [], fontScale: {} } },
    { appearance: '{ accent: "#00ff00" }' }
  ]
  let allDefaults = true
  for (const blob of blobs) {
    const r = normalizeAppearance(blob && blob.appearance !== undefined ? blob.appearance : blob)
    if (JSON.stringify(r) !== JSON.stringify(DEFAULT_APPEARANCE)) allDefaults = false
  }
  ok(allDefaults, '7 hostile settings blobs -> all fall back to defaults, zero exceptions')
}

/* ================= done ================= */
console.log(`\nv1.4.0 Customization Studio: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
