// usage-meter-pills
// Pills above the prompt: 5h / 7d limits with a pace marker and reset time, context window,
// git branch, and optionally session tokens and cost. Desktop draws an SVG; the terminal gets text.
// /usage-meter-options opens the settings pane; the gear next to the band opens it too.

const STORE_KEY = 'last-readings'
const TOTALS_KEY = 'session-totals'
const TOGGLES_KEY = 'toggles'
const PANE = 'pills-settings'
const WINDOW_MS = { five_hour: 5 * 3600e3, seven_day: 7 * 86400e3 }

const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
const CW = 7.8 // width of one character at 13px
const PILL_H = 30
const PILL_RADIUS = 10 // matches the prompt field's rounded corners

// Text colors; the tints are translucent so they sit on light and dark alike. Set by applyTheme().
let TEXT = '#d8d8d8'
let MUTED = '#9a9a9a'
let MARKER_EDGE = '#000'

const RED = '#e5604d'
const AMBER = '#e0a030'

const COLORS = {
  up: '#e5604d',
  down: '#3fa35b',
  cost: '#d4a017',
  git: '#e8845a',
}

// Accent colors a limit can use
const PALETTE = [
  ['green', 'Green', '#3fb58a'],
  ['purple', 'Purple', '#8b6cf0'],
  ['blue', 'Blue', '#5b7cf0'],
  ['orange', 'Orange', '#e8845a'],
  ['amber', 'Amber', '#e0a030'],
  ['red', 'Red', '#e5604d'],
  ['pink', 'Pink', '#e060a8'],
  ['teal', 'Teal', '#2fb5c8'],
  ['gray', 'Gray', '#8a8f98'],
  ['custom', 'Custom', '#3fb58a'],
]
const COLOR_CHOICES = PALETTE.map(([id, name]) => [id, name])

// Everything the settings pane lists, in groups. To add an option, theme or color: add an entry here
// (a `choices` entry shows all its values side by side) and a sample in previewFor().
const GROUPS = ['Appearance', 'Usage limits', 'Context window', 'Extras']
const SETTINGS = [
  {
    group: 0, key: 'style', label: 'Style', def: 'pills',
    desc: 'How each item is drawn.',
    choices: [['pills', 'Pills'], ['glass', 'Glass'], ['rings', 'Rings'], ['bars', 'Thin bars'], ['segments', 'Segments'], ['stacked', 'Stacked']],
  },
  { group: 0, key: 'roundPills', label: 'Fully rounded pills', def: false, desc: 'Pills and Glass styles only.' },
  {
    group: 0, key: 'layout', label: 'Layout', def: 'full',
    desc: 'Compact shows only the icon and percent.',
    choices: [['full', 'Full'], ['compact', 'Compact'], ['auto', 'Auto']],
  },
  { group: 0, key: 'lightTheme', label: 'Light theme text', def: false, desc: 'Dark text for light backgrounds.' },
  { group: 0, key: 'showOptionsButton', label: 'Settings button next to the band', def: true },
  { group: 1, key: 'show5h', label: '5-hour limit', def: true },
  { group: 1, key: 'show7d', label: 'Weekly limit', def: true },
  { group: 1, key: 'showResetTime', label: 'Reset time', def: true },
  {
    group: 1, key: 'resetFormat', label: 'Reset format', def: 'countdown',
    desc: 'Countdown looks like 4h 25m, clock time like 17:40.',
    choices: [['countdown', 'Countdown'], ['clock', 'Clock time']],
  },
  { group: 1, key: 'showPaceMarker', label: 'Pace marker', def: true, desc: 'Marks how far through the window you are.' },
  { group: 1, key: 'alertColors', label: 'Alert colors', def: true, desc: 'Amber or red when you use a limit faster than time passes.' },
  { group: 1, key: 'colorFiveHour', label: '5-hour color', def: 'green', choices: COLOR_CHOICES },
  { group: 1, key: 'colorSevenDay', label: 'Weekly color', def: 'purple', choices: COLOR_CHOICES },
  { group: 2, key: 'showContext', label: 'Context window', def: true },
  { group: 2, key: 'warnContext', label: 'Context warning', def: true, desc: 'Turns red near full and says compact soon.' },
  { group: 2, key: 'colorContext', label: 'Context color', def: 'blue', choices: COLOR_CHOICES },
  { group: 3, key: 'showGit', label: 'Git branch', def: true },
  { group: 3, key: 'showTokens', label: 'Session tokens', def: false },
  { group: 3, key: 'showCost', label: 'Session cost', def: false },
]

// The manifest's userConfig values
let opts = {}
// Choices made in the settings pane; they win over the manifest options
let toggles = {}
// Set while drawing a settings sample in a state other than the current one
let forced = {}
// Color edits in the settings pane show live but are only kept on Save; Cancel returns to the last saved colors.
// Every other option is kept as soon as it is changed.
let committedColors = {}
let isDirty = false

function rawSetting(key) {
  if (key in forced) return forced[key]
  if (key in toggles) return toggles[key]
  return opts[key]
}

function flag(key, fallback) {
  const v = rawSetting(key)
  if (v === undefined || v === null || v === '') return fallback
  return v === true || v === 'true'
}

function choice(key, fallback) {
  const v = rawSetting(key)
  return typeof v === 'string' && v ? v : fallback
}

function paletteColor(name, fallbackName, hexKey) {
  if (name === 'custom') {
    const hex = choice(hexKey, '')
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  }
  const hit = PALETTE.find((p) => p[0] === name) || PALETTE.find((p) => p[0] === fallbackName)
  return hit[2]
}

function limitColor(kind) {
  return kind === 'five_hour'
    ? paletteColor(choice('colorFiveHour', 'green'), 'green', 'colorFiveHourHex')
    : paletteColor(choice('colorSevenDay', 'purple'), 'purple', 'colorSevenDayHex')
}

function contextColor() {
  return paletteColor(choice('colorContext', 'blue'), 'blue', 'colorContextHex')
}

function applyTheme() {
  if (flag('lightTheme', false)) {
    TEXT = '#1f2328'
    MUTED = '#59606a'
    MARKER_EDGE = '#fff'
  } else {
    TEXT = '#d8d8d8'
    MUTED = '#9a9a9a'
    MARKER_EDGE = '#000'
  }
}

// Columns the band has, where the surface says; used by the "auto" layout
let narrowColumns = null

function isCompact() {
  const layout = choice('layout', 'full')
  if (layout === 'compact') return true
  if (layout === 'auto') return narrowColumns !== null && narrowColumns < 100
  return false
}

let ctx = { window: 0 }
let git = { branch: null, dirty: false }
let readings = {}
let totals = { startedAt: 0, input: 0, output: 0, cache: 0 }
let costUsd = null

function toMs(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  return null
}

function formatLeft(ms) {
  const total = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (d > 0) return d + 'd ' + h + 'h'
  if (h > 0) return h + 'h ' + m + 'm'
  return m + 'm'
}

// "17:40", or "Mon 14:00" when the window is a week long
function formatAt(ms, withDay) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  const time = pad(d.getHours()) + ':' + pad(d.getMinutes())
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return withDay ? days[d.getDay()] + ' ' + time : time
}

function resetText(kind, resetMs, now) {
  return choice('resetFormat', 'countdown') === 'clock'
    ? formatAt(resetMs, kind === 'seven_day')
    : formatLeft(resetMs - now)
}

function formatTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}

// Amber or red when the limit is nearly used up, or used up faster than the window is passing
function stateColor(pct, marker) {
  if (pct >= 90) return RED
  if (pct >= 70) return AMBER
  if (marker !== null && marker !== undefined) {
    const ahead = pct / 100 - marker
    if (ahead > 0.3) return RED
    if (ahead > 0.15) return AMBER
  }
  return null
}

const isColorKey = (key) => key.startsWith('color')

function pickColors(from) {
  const out = {}
  for (const k of Object.keys(from)) if (isColorKey(k)) out[k] = from[k]
  return out
}

// Keep every option except the colors that are still waiting for Save
async function persistToggles($) {
  const out = {}
  for (const k of Object.keys(toggles)) if (!isColorKey(k)) out[k] = toggles[k]
  await $.store.set(TOGGLES_KEY, { ...out, ...committedColors })
}

async function openOptions($) {
  if (!isDirty) committedColors = pickColors(toggles)
  await $.ui.open({ id: PANE, title: 'Usage pills' })
}

async function refresh($) {
  try {
    const usage = await $.session.usage()
    const list = usage && Array.isArray(usage.rateLimits) ? usage.rateLimits : []
    const before = JSON.stringify(readings)
    for (const r of list) {
      if (r.kind !== 'five_hour' && r.kind !== 'seven_day') continue
      readings[r.kind] = { percentUsed: r.percentUsed, resetsAt: r.resetsAt }
    }
    if (JSON.stringify(readings) !== before) await $.store.set(STORE_KEY, readings)
    costUsd = usage && usage.cost ? usage.cost.usd : null
    if (usage && usage.context) ctx = usage.context
    // Token totals belong to one session; start over when the session did
    if (usage && usage.startedAt && totals.startedAt !== usage.startedAt) {
      totals = { startedAt: usage.startedAt, input: 0, output: 0, cache: 0 }
    }
  } catch {
    // keep what is shown
  }
  if (flag('showGit', true)) await refreshGit($)
  $.ui.invalidate('ui.render')
}

// Branch name and whether the tree has changes; no branch when the folder is not a repo.
// Falls back to reading .git/HEAD where running git is not allowed.
async function refreshGit($) {
  try {
    const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    if (head.exitCode !== 0) {
      git = { branch: null, dirty: false }
      return
    }
    let branch = head.stdout.trim()
    if (branch === 'HEAD') {
      const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'])
      branch = sha.stdout.trim()
    }
    const status = await $.process.run(['git', 'status', '--porcelain'])
    git = { branch, dirty: status.exitCode === 0 && status.stdout.trim().length > 0 }
  } catch {
    try {
      const raw = String(await $.fs.read('.git/HEAD')).trim()
      const m = raw.match(/^ref: refs\/heads\/(.+)$/)
      git = { branch: m ? m[1] : raw.slice(0, 7), dirty: false }
    } catch {
      git = { branch: null, dirty: false }
    }
  }
}

// ---- SVG pieces -------------------------------------------------------------

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function text(x, str, fill, bold, y, size) {
  return '<text x="' + x + '" y="' + (y || 21) + '" font-family="' + FONT + '" font-size="' + (size || 13) + '" fill="' + fill + '"' +
    (bold ? ' font-weight="700"' : '') + '>' + esc(str) + '</text>'
}

function pillBg(x, w, color) {
  const radius = flag('roundPills', false) ? PILL_H / 2 : PILL_RADIUS
  if (choice('style', 'pills') === 'glass') {
    return '<rect x="' + x + '" y="2" width="' + w + '" height="' + PILL_H + '" rx="' + radius + '" fill="' + color + '" fill-opacity="0.1"/>' +
      '<rect x="' + x + '" y="2" width="' + w + '" height="' + PILL_H + '" rx="' + radius + '" fill="#fff" fill-opacity="0.07" stroke="#fff" stroke-opacity="0.2"/>' +
      '<rect x="' + (x + 1) + '" y="3" width="' + (w - 2) + '" height="' + (PILL_H / 2 - 1) + '" rx="' + Math.max(0, radius - 1) + '" fill="#fff" fill-opacity="0.06"/>'
  }
  return '<rect x="' + x + '" y="2" width="' + w + '" height="' + PILL_H + '" rx="' + radius +
    '" fill="' + color + '" fill-opacity="0.2" stroke="' + color + '" stroke-opacity="0.35"/>'
}

const ICON_ATTR = ' fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
// Each icon is drawn in a 16x16 box at (x, 9)
const ICONS = {
  branch: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><circle cx="4.5" cy="3.5" r="1.8"/><circle cx="4.5" cy="12.5" r="1.8"/><circle cx="11.5" cy="5.5" r="1.8"/><path d="M4.5 5.3v5.4M11.5 7.3c0 3-7 1.5-7 3.4"/></g>',
  gauge: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><path d="M2.5 12.5a6.5 6.5 0 1 1 11 0"/><path d="M8 9.5l2.6-3.2"/></g>',
  clock: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1L2.5 5.6"/><path d="M2.5 2.8v2.8h2.8"/><path d="M8 5v3.2l2 1.2"/></g>',
  calendar: (x, c) => '<g transform="translate(' + x + ' 9)"><rect x="1.5" y="2.5" width="13" height="12" rx="2.5" fill="' + c +
    '"/><path d="M5 1v3M11 1v3" stroke="' + c + '"' + ICON_ATTR + '/></g>',
  up: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><path d="M8 10V2.5M5 5l3-3 3 3"/><path d="M2 10v3.5h12V10"/></g>',
  down: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><path d="M8 2v7.5M5 7l3 3 3-3"/><path d="M2 10v3.5h12V10"/></g>',
  layers: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3"/><path d="M2 11l6 3 6-3"/></g>',
  coin: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><circle cx="8" cy="8" r="6.2"/><path d="M10 6c-.4-.8-1.2-1.2-2-1.2-1.2 0-2 .6-2 1.5 0 2 4 1 4 3 0 .9-.9 1.5-2 1.5-.9 0-1.7-.4-2-1.2M8 3.8v8.4"/></g>',
}

// ---- Rings style: a progress ring with the icon inside, then the percent and the time -------------

const styleName = () => choice('style', 'pills')
// pills and glass keep a background shape; every other style draws bare items
const isBare = () => ['rings', 'bars', 'segments', 'stacked'].includes(styleName())
const ITEM_GAPS = { rings: 26, bars: 30, segments: 26, stacked: 28 }
const itemGap = () => ITEM_GAPS[styleName()] || 8

// Shared by the bare styles: the state color (alert) and the label/detail text of an item
function itemState(o) {
  if (o.pct === null) return null
  if (o.warn) return RED
  return flag('alertColors', true) ? stateColor(o.pct, o.marker) : null
}

function ringItem(x, o) {
  const R = 12
  const C = 2 * Math.PI * R
  const mx = x + 15 // ring centre
  const my = 17
  const compact = isCompact()
  let state = null
  if (o.pct !== null) {
    if (o.warn) state = RED
    else if (flag('alertColors', true)) state = stateColor(o.pct, o.marker)
  }
  const accent = state || o.color
  let body = '<circle cx="' + mx + '" cy="' + my + '" r="' + R + '" fill="none" stroke="' + TEXT +
    '" stroke-opacity="0.14" stroke-width="3"/>'
  if (o.pct !== null && o.pct > 0) {
    const arc = Math.max(2, (C * Math.min(100, o.pct)) / 100)
    body += '<circle cx="' + mx + '" cy="' + my + '" r="' + R + '" fill="none" stroke="' + accent +
      '" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + arc + ' ' + C +
      '" transform="rotate(-90 ' + mx + ' ' + my + ')"/>'
  }
  if (o.pct !== null && o.marker !== null && o.marker !== undefined) {
    const a = o.marker * 2 * Math.PI - Math.PI / 2
    const x1 = mx + (R - 4) * Math.cos(a)
    const y1 = my + (R - 4) * Math.sin(a)
    const x2 = mx + (R + 3) * Math.cos(a)
    const y2 = my + (R + 3) * Math.sin(a)
    body += '<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) +
      '" stroke="' + TEXT + '" stroke-width="2" stroke-linecap="round"/>'
  }
  // the ring already says which limit it is, so the 5h one gets a clock like the reference style
  body += ICONS[o.icon === 'gauge' ? 'clock' : o.icon](mx - 8, o.color)
  let tx = x + 15 + R + 10
  if (o.pct === null) {
    body += text(tx, '–', MUTED)
    return { w: tx + CW - x, svg: body }
  }
  const pctStr = o.pct + '%'
  body += text(tx, pctStr, state || TEXT, true)
  tx += pctStr.length * CW
  if (!compact && o.tail) {
    tx += 8
    body += text(tx, o.tail, MUTED)
    tx += o.tail.length * CW
  }
  return { w: tx - x, svg: body }
}

function ringStat(x, icon, color, str) {
  const w = 16 + 8 + str.length * CW
  return { w, svg: ICONS[icon](x, color) + text(x + 24, str, TEXT) }
}
// ---- Bars, segments and stacked: bare items without a background shape -------------------------

// "5h · 4h 3m": the label and the reset time / token count, as small muted text
const detailOf = (o) => o.label + (o.tail ? ' · ' + o.tail : '')

function thinBarItem(x, o) {
  const compact = isCompact()
  if (o.pct === null) return { w: (o.label.length + 2) * CW, svg: text(x, o.label + ' –', MUTED, false, 16) }
  const state = itemState(o)
  const accent = state || o.color
  const pctStr = o.pct + '%'
  const head = text(x, pctStr, state || TEXT, true, 16, 14)
  const detail = compact ? '' : detailOf(o)
  const textW = pctStr.length * 8.4 + (detail ? 8 + detail.length * CW : 0)
  let body = head + (detail ? text(x + pctStr.length * 8.4 + 8, detail, MUTED, false, 16) : '')
  if (compact) return { w: textW, svg: body }
  const W = Math.max(150, textW)
  body += '<rect x="' + x + '" y="21" width="' + W + '" height="4" rx="2" fill="' + TEXT + '" fill-opacity="0.14"/>'
  body += '<rect x="' + x + '" y="21" width="' + Math.max(4, (W * Math.min(100, o.pct)) / 100) + '" height="4" rx="2" fill="' + accent + '"/>'
  if (o.marker !== null && o.marker !== undefined) {
    body += '<rect x="' + (x + W * o.marker - 1) + '" y="18" width="2" height="10" rx="1" fill="' + TEXT + '"/>'
  }
  return { w: W, svg: body }
}

function segmentItem(x, o) {
  const compact = isCompact()
  let cx = x
  let body = text(cx, o.label, MUTED)
  cx += o.label.length * CW + 8
  if (o.pct === null) return { w: cx + CW - x, svg: body + text(cx, '–', MUTED) }
  const state = itemState(o)
  const accent = state || o.color
  if (!compact) {
    const lit = o.pct > 0 ? Math.max(1, Math.round(o.pct / 10)) : 0
    for (let i = 0; i < 10; i++) {
      body += '<rect x="' + (cx + i * 9) + '" y="10" width="7" height="14" rx="2" fill="' + (i < lit ? accent : TEXT) +
        '"' + (i < lit ? '' : ' fill-opacity="0.14"') + '/>'
    }
    if (o.marker !== null && o.marker !== undefined) {
      body += '<rect x="' + (cx + o.marker * 89 - 1) + '" y="7" width="2" height="20" rx="1" fill="' + TEXT + '"/>'
    }
    cx += 89 + 10
  }
  const pctStr = o.pct + '%'
  body += text(cx, pctStr, state || TEXT, true)
  cx += pctStr.length * CW
  if (!compact && o.tail) {
    cx += 8
    body += text(cx, o.tail, MUTED)
    cx += o.tail.length * CW
  }
  return { w: cx - x, svg: body }
}

function stackedItem(x, o) {
  const compact = isCompact()
  const bar = (color) => '<rect x="' + x + '" y="5" width="3" height="24" rx="1.5" fill="' + color + '"/>'
  const tx = x + 11
  if (o.pct === null) return { w: 11 + (o.label.length + 2) * CW, svg: bar(o.color) + text(tx, o.label + ' –', MUTED) }
  const state = itemState(o)
  const pctStr = o.pct + '%'
  if (compact) {
    return { w: 11 + pctStr.length * 8.4, svg: bar(state || o.color) + text(tx, pctStr, state || TEXT, true, 21, 14) }
  }
  const second = o.tail || ''
  const line1W = o.label.length * 7.2 + 6 + pctStr.length * 9
  const line2W = second.length * 7.2
  let body = bar(state || o.color)
  body += text(tx, o.label, o.color, false, 15, 12)
  body += text(tx + o.label.length * 7.2 + 6, pctStr, state || TEXT, true, 15, 15)
  if (second) body += text(tx, second, MUTED, false, 28, 12)
  return { w: 11 + Math.max(line1W, line2W), svg: body }
}
// A pill with a bar: icon, label, bar (optional pace marker), percent, optional "| icon tail".
// Compact layout keeps only the icon and the percent. `warn` forces the alert color.
function barPill(x, o) {
  const style = styleName()
  if (style === 'rings') return ringItem(x, o)
  if (style === 'bars') return thinBarItem(x, o)
  if (style === 'segments') return segmentItem(x, o)
  if (style === 'stacked') return stackedItem(x, o)
  const BAR = 76
  const compact = isCompact()
  let cx = x + 14
  let body = ICONS[o.icon](cx, o.color)
  cx += 16 + 8
  if (o.pct === null) {
    if (!compact) {
      body += text(cx, o.label, MUTED)
      cx += o.label.length * CW + 8
    }
    body += text(cx, '–', MUTED)
    cx += CW + 14
    return { w: cx - x, svg: pillBg(x, cx - x, o.color) + body }
  }
  let state = null
  if (o.warn) state = RED
  else if (flag('alertColors', true)) state = stateColor(o.pct, o.marker)
  const accent = state || o.color
  const pctStr = o.pct + '%'
  if (compact) {
    body += text(cx, pctStr, state || TEXT, true)
    cx += pctStr.length * CW + 14
    return { w: cx - x, svg: pillBg(x, cx - x, accent) + body }
  }
  body += text(cx, o.label, MUTED)
  cx += o.label.length * CW + 8
  body += '<rect x="' + cx + '" y="13.5" width="' + BAR + '" height="7" rx="3.5" fill="' + TEXT + '" fill-opacity="0.14"/>'
  body += '<rect x="' + cx + '" y="13.5" width="' + Math.max(7, (BAR * Math.min(100, o.pct)) / 100) +
    '" height="7" rx="3.5" fill="' + accent + '"/>'
  if (o.marker !== null && o.marker !== undefined) {
    body += '<rect x="' + (cx + BAR * o.marker - 1.25) + '" y="10" width="2.5" height="14" rx="1.25" fill="' + TEXT +
      '" stroke="' + MARKER_EDGE + '" stroke-opacity="0.45" stroke-width="1"/>'
  }
  cx += BAR + 10
  body += text(cx, pctStr, state || TEXT, true)
  cx += pctStr.length * CW + 9
  if (o.tail) {
    body += '<line x1="' + cx + '" y1="10" x2="' + cx + '" y2="24" stroke="' + MUTED + '" stroke-opacity="0.4"/>'
    cx += 9
    if (o.tailIcon) {
      body += ICONS[o.tailIcon](cx, o.color)
      cx += 16 + 6
    }
    body += text(cx, o.tail, MUTED)
    cx += o.tail.length * CW
  }
  cx += 14
  return { w: cx - x, svg: pillBg(x, cx - x, accent) + body }
}

function limitPill(x, kind, label, icon, now) {
  const r = readings[kind]
  const resetMs = r ? toMs(r.resetsAt) : null
  const isLive = r && typeof r.percentUsed === 'number' && !(resetMs !== null && resetMs <= now)
  const color = limitColor(kind)
  if (!isLive) return barPill(x, { icon, label, color, pct: null })
  const hasReset = resetMs !== null
  return barPill(x, {
    icon,
    label,
    color,
    pct: Math.round(r.percentUsed),
    marker: hasReset && flag('showPaceMarker', true)
      ? Math.min(1, Math.max(0, 1 - (resetMs - now) / WINDOW_MS[kind]))
      : null,
    tail: hasReset && flag('showResetTime', true) ? resetText(kind, resetMs, now) : null,
    tailIcon: 'clock',
  })
}

function contextPill(x) {
  const pct = typeof ctx.percent === 'number' ? Math.round(ctx.percent) : null
  const warn = pct !== null && flag('warnContext', true) && pct >= 85
  let tail = pct !== null && ctx.window ? formatTokens(ctx.tokens || 0) + '/' + formatTokens(ctx.window) : null
  if (warn) tail = '⚠ compact soon'
  return barPill(x, { icon: 'layers', label: 'ctx', color: contextColor(), pct, warn, tail })
}

function statPill(x, icon, color, str) {
  if (isBare()) return ringStat(x, icon, color, str)
  const w = 14 + 16 + 8 + str.length * CW + 14
  return { w, svg: pillBg(x, w, color) + ICONS[icon](x + 14, color) + text(x + 14 + 24, str, TEXT) }
}

function buildSvg(now) {
  applyTheme()
  const parts = []
  let x = 0
  // pills are built at their final x, so each one's gap is settled before it is drawn
  const place = (make) => {
    const gap = parts.length ? itemGap() : 0
    const p = make(x + gap)
    parts.push(p.svg)
    x += gap + p.w
  }
  if (flag('show5h', true)) place((px) => limitPill(px, 'five_hour', '5h', 'gauge', now))
  if (flag('show7d', true)) place((px) => limitPill(px, 'seven_day', '7d', 'calendar', now))
  if (flag('showContext', true)) place((px) => contextPill(px))
  if (flag('showGit', true) && git.branch) {
    place((px) => statPill(px, 'branch', COLORS.git, git.branch + (git.dirty ? ' ●' : '')))
  }
  if (flag('showTokens', false)) {
    place((px) => statPill(px, 'up', COLORS.up, formatTokens(totals.input)))
    place((px) => statPill(px, 'down', COLORS.down, formatTokens(totals.output)))
    place((px) => statPill(px, 'layers', contextColor(), formatTokens(totals.cache)))
  }
  if (flag('showCost', false) && costUsd !== null) {
    place((px) => statPill(px, 'coin', COLORS.cost, '$' + costUsd.toFixed(2)))
  }
  const w = Math.max(1, Math.ceil(x))
  return {
    w,
    source: '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + PILL_H +
      '" viewBox="0 2 ' + w + ' ' + PILL_H + '">' + parts.join('') + '</svg>',
  }
}

// Terminal and anything without Svg
function textLine(now) {
  const compact = isCompact()
  const seg = (kind, label) => {
    const r = readings[kind]
    const resetMs = r ? toMs(r.resetsAt) : null
    if (!r || typeof r.percentUsed !== 'number' || (resetMs !== null && resetMs <= now)) return label + ' –'
    let s = label + ' ' + Math.round(r.percentUsed) + '%'
    if (!compact && resetMs !== null && flag('showResetTime', true)) s += ' · ' + resetText(kind, resetMs, now)
    return s
  }
  const bits = []
  if (flag('show5h', true)) bits.push(seg('five_hour', '5h'))
  if (flag('show7d', true)) bits.push(seg('seven_day', '7d'))
  if (flag('showContext', true) && typeof ctx.percent === 'number') {
    const pct = Math.round(ctx.percent)
    bits.push('ctx ' + pct + '%' + (flag('warnContext', true) && pct >= 85 ? ' ⚠' : ''))
  }
  if (flag('showGit', true) && git.branch) bits.push('⎇ ' + git.branch + (git.dirty ? '*' : ''))
  if (flag('showTokens', false)) {
    bits.push('↑' + formatTokens(totals.input), '↓' + formatTokens(totals.output), '◈' + formatTokens(totals.cache))
  }
  if (flag('showCost', false) && costUsd !== null) bits.push('$' + costUsd.toFixed(2))
  return bits.join('  ')
}

// Wraps pills built at x = 0 into a small SVG; an option that is off is drawn faded
function miniSvg(pills, isOn) {
  let x = 0
  const parts = []
  for (const make of pills) {
    const p = make(x)
    parts.push(p.svg)
    x += p.w + itemGap()
  }
  const w = Math.max(1, Math.ceil(x - itemGap()))
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + PILL_H + '" viewBox="0 2 ' + w + ' ' +
    PILL_H + '"><g opacity="' + (isOn ? 1 : 0.4) + '">' + parts.join('') + '</g></svg>'
}

// A sample of the pill an option controls, from live data where there is some.
// Choice samples show the value that is selected now.
function previewFor(key, isOn, now) {
  const r5 = readings.five_hour
  const reset5 = r5 ? toMs(r5.resetsAt) : null
  const sampleReset = reset5 !== null && reset5 > now ? reset5 : now + (2 * 60 + 40) * 60000
  const five = (o) => (x) => barPill(x, Object.assign({ icon: 'gauge', label: '5h', color: limitColor('five_hour') }, o))
  const sample = (list) => miniSvg(list, isOn)
  switch (key) {
    case 'roundPills': {
      forced = { roundPills: true }
      try {
        return sample([(x) => statPill(x, 'gauge', limitColor('five_hour'), 'Rounded')])
      } finally {
        forced = {}
      }
    }
    case 'lightTheme':
      return sample([(x) => statPill(x, 'gauge', limitColor('five_hour'), 'Sample')])
    case 'style':
    case 'layout':
      return sample([five({ pct: 24 })])
    case 'show5h':
      return sample([five({ pct: 24 })])
    case 'show7d':
      return sample([(x) => barPill(x, { icon: 'calendar', label: '7d', color: limitColor('seven_day'), pct: 58 })])
    case 'showResetTime':
    case 'resetFormat':
      return sample([(x) => statPill(x, 'clock', limitColor('five_hour'), resetText('five_hour', sampleReset, now))])
    case 'showPaceMarker':
      return sample([five({ pct: 40, marker: 0.6 })])
    case 'alertColors':
      return sample([five({ pct: 55, marker: 0.2 })])
    case 'showContext':
      return sample([(x) => barPill(x, { icon: 'layers', label: 'ctx', color: contextColor(), pct: 15, tail: '148.6k/1.0M' })])
    case 'warnContext': {
      const warn = flag('warnContext', true)
      return sample([(x) => barPill(x, {
        icon: 'layers', label: 'ctx', color: contextColor(), pct: 92, warn, tail: warn ? '⚠ compact soon' : '920.0k/1.0M',
      })])
    }
    case 'showGit':
      return sample([(x) => statPill(x, 'branch', COLORS.git, (git.branch || 'main') + (git.dirty ? ' ●' : ''))])
    case 'colorFiveHour':
      return sample([five({ pct: 24 })])
    case 'colorSevenDay':
      return sample([(x) => barPill(x, { icon: 'calendar', label: '7d', color: limitColor('seven_day'), pct: 24 })])
    case 'colorContext':
      return sample([(x) => barPill(x, { icon: 'layers', label: 'ctx', color: contextColor(), pct: 24 })])
    case 'showTokens':
      return sample([
        (x) => statPill(x, 'up', COLORS.up, '15.6k'),
        (x) => statPill(x, 'down', COLORS.down, '3.0k'),
        (x) => statPill(x, 'layers', contextColor(), '954.2k'),
      ])
    case 'showCost':
      return sample([(x) => statPill(x, 'coin', COLORS.cost, '$4.32')])
    default:
      return null
  }
}

export function register(on, options) {
  opts = options || {}

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get(STORE_KEY)
    if (saved && typeof saved === 'object') readings = saved
    const savedToggles = await $.store.get(TOGGLES_KEY)
    if (savedToggles && typeof savedToggles === 'object') {
      toggles = savedToggles
      committedColors = pickColors(toggles)
    }
    await $.command.register({ name: 'usage-meter-options', description: 'Choose which pills the usage band shows' })
    const savedTotals = await $.store.get(TOTALS_KEY)
    if (savedTotals && typeof savedTotals === 'object') totals = savedTotals
    await refresh($)
    $.clock.every(60000, () => refresh($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  // Add each turn's tokens to the running totals
  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      totals.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      totals.output += u.output_tokens || 0
      totals.cache += u.cache_read_input_tokens || 0
      await $.store.set(TOTALS_KEY, totals)
    }
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'usage-meter-options' }, async ($) => {
    await openOptions($)
    return { text: 'Usage pills settings opened.' }
  })

  // The settings pane. Everything is driven by SETTINGS/GROUPS, so a new option, theme or color
  // only needs an entry there (and a sample in previewFor).
  //  - a checkbox row: a press flips it
  //  - a choice row: every value is shown side by side, the selected one highlighted; a press selects it
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    applyTheme()
    const { Box, Text, Button, Svg, Input } = $.ui.resolve(e)
    const now = Date.now()

    const change = (s, value) => async () => {
      toggles = { ...toggles, [s.key]: value }
      if (isColorKey(s.key)) isDirty = true
      else await persistToggles($)
      if (s.key === 'showGit') await refreshGit($)
      $.ui.invalidate('ui.render')
    }

    // A small picture of what the option does, right-aligned
    const sampleFor = (s, isOn) => {
      const sample = Svg ? previewFor(s.key, isOn, now) : null
      if (!sample) return Text({ children: [''] })
      const w = Number(sample.match(/width="([\d.]+)"/)[1])
      return Svg({ source: sample, alt: s.label, width: w, height: PILL_H })
    }

    const hint = (s) => (s.desc ? Text({ dimColor: true, children: [s.desc] }) : null)

    const row = (s) => {
      if (Array.isArray(s.choices)) {
        const current = choice(s.key, s.def)
        const parts = [
          Box({
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            children: [Text({ bold: true, children: [s.label] }), sampleFor(s, true)],
          }),
          hint(s),
          Box({
            flexDirection: 'row',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 1,
            children: s.choices.map(([value, name]) =>
              Button({
                key: s.key + ':' + value,
                label: name,
                variant: value === current ? 'primary' : 'secondary',
                onPress: change(s, value),
              }),
            ),
          }),
        ]
        if (isColorKey(s.key) && current === 'custom') {
          const hexKey = s.key + 'Hex'
          parts.push(
            Input({
              key: hexKey,
              label: 'Hex color  ',
              placeholder: '#RRGGBB',
              value: choice(hexKey, ''),
              submitLabel: 'apply',
              onSubmit: async (value) => {
                const hex = ('#' + String(value).trim().replace(/^#/, '')).toLowerCase()
                if (!/^#[0-9a-f]{6}$/.test(hex)) return
                toggles = { ...toggles, [hexKey]: hex }
                isDirty = true
                $.ui.invalidate('ui.render')
              },
            }),
          )
        }
        return Box({ flexDirection: 'column', gap: 1, children: parts.filter(Boolean) })
      }
      const isOn = flag(s.key, s.def)
      return Box({
        flexDirection: 'column',
        children: [
          Box({
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            children: [
              Button({ key: s.key, label: (isOn ? '✅  ' : '⬜  ') + s.label, plain: true, onPress: change(s, !isOn) }),
              sampleFor(s, isOn),
            ],
          }),
          hint(s),
        ].filter(Boolean),
      })
    }

    const sections = GROUPS.map((title, g) =>
      Box({
        flexDirection: 'column',
        gap: 1,
        children: [
          Text({ bold: true, children: [title.toUpperCase()] }),
          Text({ dimColor: true, children: ['─'.repeat(48)] }),
          Box({
            flexDirection: 'column',
            gap: 1,
            paddingLeft: 1,
            children: SETTINGS.filter((s) => s.group === g).map(row),
          }),
        ],
      }),
    )

    const saveBar = isDirty
      ? [
          Box({
            flexDirection: 'row',
            columnGap: 2,
            alignItems: 'center',
            children: [
              Button({
                key: 'save',
                label: 'Save colors',
                variant: 'primary',
                onPress: async () => {
                  committedColors = pickColors(toggles)
                  await $.store.set(TOGGLES_KEY, toggles)
                  isDirty = false
                  $.ui.toast('Colors saved')
                  $.ui.invalidate('ui.render')
                },
              }),
              Button({
                key: 'cancel',
                label: 'Cancel',
                variant: 'secondary',
                onPress: async () => {
                  const keep = {}
                  for (const k of Object.keys(toggles)) if (!isColorKey(k)) keep[k] = toggles[k]
                  toggles = { ...keep, ...committedColors }
                  isDirty = false
                  $.ui.invalidate('ui.render')
                },
              }),
              Text({ dimColor: true, children: ['Color changes are not saved yet'] }),
            ],
          }),
        ]
      : []

    return Box({
      flexDirection: 'column',
      gap: 2,
      paddingY: 1,
      children: [
        Box({
          flexDirection: 'column',
          children: [
            Text({ bold: true, children: ['Usage meter'] }),
            Text({ dimColor: true, children: ['Pick an option to change it. Everything applies right away; only colors need Save.'] }),
          ],
        }),
        ...saveBar,
        ...sections,
      ],
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    applyTheme()
    narrowColumns = e.props && typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : null
    const els = $.ui.resolve(e)
    const others = await next(e)
    const now = Date.now()
    const line = textLine(now)
    if (!line) return others
    let row
    if (e.surface === 'terminal' || !els.Svg) {
      row = els.Text({ dimColor: true, wrap: 'truncate', children: [line] })
    } else {
      const svg = buildSvg(now)
      row = els.Svg({ source: svg.source, alt: line, width: svg.w, height: PILL_H })
    }
    if (flag('showOptionsButton', true)) {
      const gear = els.Button({
        key: 'open-options',
        label: ' ⚙️ ',
        plain: true,
        onPress: () => openOptions($),
      })
      row = els.Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, children: [row, gear] })
    }
    return others ? els.Box({ flexDirection: 'column', children: [row, others] }) : row
  })
}
