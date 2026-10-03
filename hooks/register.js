// usage-meter-pills
// Pills above the prompt: 5h / 7d limits with a pace marker and reset time, context window,
// git branch, prompt cache warmth, and optionally session tokens and cost. Desktop draws an SVG; the terminal gets text.
// /usage-meter-options opens the settings pane; the gear next to the band opens it too.

const STORE_KEY = 'last-readings'
const TOTALS_KEY = 'session-totals'
const TOGGLES_KEY = 'toggles'
const CACHE_KEY = 'cache-warmth'
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
  warm: '#f07a3c',
  cold: '#6aa8d8',
}

const CACHE_TTL_MS = { '5m': 5 * 60000, '1h': 3600e3 }
// A keep-warm ping goes out this long before the cache would expire
const PING_MARGIN_MS = { '5m': 60000, '1h': 10 * 60000 }
const KEEP_WARM_MS = { '1h': 3600e3, '3h': 3 * 3600e3, '6h': 6 * 3600e3, '12h': 12 * 3600e3 }
const PING_PROMPT = 'Reply with the single word: warm'

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
  ['custom', 'Custom (type a hex color)', '#3fb58a'],
]
const COLOR_CHOICES = PALETTE.map(([id, name]) => [id, name])

// Everything the settings pane lists, in groups. A `choices` entry cycles through its values on a press.
const GROUPS = ['Appearance', 'Usage limits', 'Context window', 'Extras']
const SETTINGS = [
  { group: 0, key: 'style', label: 'Style', def: 'pills', choices: [['pills', 'Pills'], ['rings', 'Rings (progress circle)']] },
  { group: 0, key: 'roundPills', label: 'Fully rounded pills', def: false },
  { group: 0, key: 'lightTheme', label: 'Light theme text', def: false },
  {
    group: 0,
    key: 'layout',
    label: 'Layout',
    def: 'full',
    choices: [['full', 'Full'], ['compact', 'Compact'], ['auto', 'Auto (compact when narrow)']],
  },
  { group: 0, key: 'showOptionsButton', label: 'Settings button next to the band', def: true },
  { group: 1, key: 'show5h', label: '5-hour limit', def: true },
  { group: 1, key: 'show7d', label: 'Weekly limit', def: true },
  { group: 1, key: 'showResetTime', label: 'Reset time', def: true },
  {
    group: 1,
    key: 'resetFormat',
    label: 'Reset format',
    def: 'countdown',
    choices: [['countdown', 'Countdown (4h 25m)'], ['clock', 'Clock time (17:40)']],
  },
  { group: 1, key: 'showPaceMarker', label: 'Pace marker', def: true },
  { group: 1, key: 'alertColors', label: 'Alert colors when burning too fast', def: true },
  { group: 1, key: 'colorFiveHour', label: '5-hour color', def: 'green', choices: COLOR_CHOICES },
  { group: 1, key: 'colorSevenDay', label: 'Weekly color', def: 'purple', choices: COLOR_CHOICES },
  { group: 2, key: 'showContext', label: 'Context window', def: true },
  { group: 2, key: 'warnContext', label: 'Context warning near full', def: true },
  { group: 2, key: 'colorContext', label: 'Context color', def: 'blue', choices: COLOR_CHOICES },
  { group: 3, key: 'showGit', label: 'Git branch', def: true },
  { group: 3, key: 'showCache', label: 'Prompt cache warm or cold', def: true },
  {
    group: 3,
    key: 'cacheTtl',
    label: 'Prompt cache lifetime',
    def: '1h',
    choices: [['1h', '1 hour'], ['5m', '5 minutes']],
  },
  { group: 3, key: 'keepWarm', label: 'Keep the cache warm while idle', def: false },
  {
    group: 3,
    key: 'keepWarmFor',
    label: 'Keep it warm for',
    def: '6h',
    choices: [['1h', '1 hour after the last turn'], ['3h', '3 hours after the last turn'], ['6h', '6 hours after the last turn'], ['12h', '12 hours after the last turn']],
  },
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
// When the main thread last read or wrote the prompt cache (a keep-warm ping counts), when its
// last real turn ended, and the session that was in. `busy` while a turn runs: its requests keep
// the cache warm.
let cache = { at: 0, turnAt: 0, startedAt: 0, busy: false }
let sessionStartedAt = 0
let cacheTimer = null
// Keep-warm: a ping in flight, how many pings this session, and why pinging stopped until the next turn
let keep = { pinging: false, pings: 0, stopped: null }

function cacheTtlMs() {
  return CACHE_TTL_MS[choice('cacheTtl', '1h')] || CACHE_TTL_MS['1h']
}

// Milliseconds the cache stays warm, 0 when cold; Infinity while a turn runs
function cacheLeft(now) {
  if (cache.busy) return Infinity
  if (!cache.at) return 0
  return Math.max(0, cache.at + cacheTtlMs() - now)
}

// "42m", rounded up so it reads "1m" until the moment it goes cold
function formatCacheLeft(ms) {
  const m = Math.ceil(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm'
}

function cacheLabel(now) {
  const left = cacheLeft(now)
  if (left === Infinity) return 'warm'
  return left > 0 ? formatCacheLeft(left) : 'cold'
}

// When keep-warm stops pinging: the window after the last real turn. 0 when it is off.
function keepWarmUntil() {
  if (!flag('keepWarm', false) || keep.stopped || !cache.turnAt) return 0
  return cache.turnAt + (KEEP_WARM_MS[choice('keepWarmFor', '6h')] || KEEP_WARM_MS['6h'])
}

// Time left in the keep-warm window while it is holding a warm cache, else 0
function keptLeft(now) {
  const until = keepWarmUntil()
  return until && cacheLeft(now) > 0 ? Math.max(0, until - now) : 0
}

// One timer: the next keep-warm ping when one is due inside the window, else a redraw the
// moment the cache goes cold rather than at the next minute tick
function armCache($) {
  if (cacheTimer) cacheTimer.cancel()
  cacheTimer = null
  const now = Date.now()
  const left = cacheLeft(now)
  if (left <= 0 || left === Infinity) return
  const ttl = choice('cacheTtl', '1h')
  const pingAt = cache.at + cacheTtlMs() - (PING_MARGIN_MS[ttl] || PING_MARGIN_MS['1h'])
  if (pingAt < keepWarmUntil()) {
    cacheTimer = $.clock.after(Math.max(1000, pingAt - now), () => { void pingCache($) })
  } else {
    cacheTimer = $.clock.after(left + 250, () => $.ui.invalidate('ui.render'))
  }
}

function stopKeepWarm($, why) {
  keep.stopped = why
  $.ui.toast('Keep-warm stopped: ' + why)
  armCache($)
  $.ui.invalidate('ui.render')
}

// A one-word fork of the main thread's own transcript: the API serves it from the cache, which
// restarts the cache's clock. Same approach as cache-tax (github.com/karanb192/cache-tax, MIT).
async function pingCache($) {
  cacheTimer = null
  if (keep.pinging || cache.busy) return
  const now = Date.now()
  if (now >= keepWarmUntil() || cacheLeft(now) <= 0) return armCache($)
  keep.pinging = true
  let reply
  try {
    reply = await $.model.fork({ prompt: PING_PROMPT })
  } catch (err) {
    reply = { isAnswered: false, reason: err instanceof Error ? err.message : String(err) }
  } finally {
    keep.pinging = false
  }
  // A turn that started meanwhile restarts the clock itself
  if (cache.busy) return
  const u = reply && reply.usage
  if (!u) return stopKeepWarm($, 'the ping was not sent (' + ((reply && reply.reason) || 'no reply') + ')')
  const read = u.cache_read_input_tokens || 0
  const write = u.cache_creation_input_tokens || 0
  // A warm ping reads the transcript and writes little more than its own message
  if (read === 0 || write >= 0.1 * read) {
    // That write cached the transcript again, so it is warm from now; just not cheaply
    if (write > 0) cache = { ...cache, at: Date.now() }
    return stopKeepWarm($, 'the cache had already gone (the ping re-wrote ' + formatTokens(write) + ' tokens)')
  }
  keep.pings += 1
  cache = { ...cache, at: Date.now() }
  await $.store.set(CACHE_KEY, { at: cache.at, turnAt: cache.turnAt, startedAt: cache.startedAt })
  armCache($)
  $.ui.invalidate('ui.render')
}

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
    // After /clear the next request starts a new transcript, so the old cache is no use
    if (usage && usage.startedAt) {
      sessionStartedAt = usage.startedAt
      if (cache.at && cache.startedAt !== usage.startedAt) {
        cache = { ...cache, at: 0, turnAt: 0 }
        armCache($)
      }
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

function text(x, str, fill, bold) {
  return '<text x="' + x + '" y="21" font-family="' + FONT + '" font-size="13" fill="' + fill + '"' +
    (bold ? ' font-weight="700"' : '') + '>' + esc(str) + '</text>'
}

function pillBg(x, w, color) {
  const radius = flag('roundPills', false) ? PILL_H / 2 : PILL_RADIUS
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
  flame: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><path d="M8 1.8c.5 2.4 4 3.8 4 7.4a4 4 0 0 1-8 0c0-1.7.8-2.8 1.7-3.5.1 1.3.7 2.1 1.6 2.3C6.9 6.1 7.1 3.7 8 1.8z"/></g>',
  snow: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5"/><path d="M6.3 2.6L8 4l1.7-1.4M6.3 13.4L8 12l1.7 1.4"/></g>',
  coin: (x, c) => '<g transform="translate(' + x + ' 9)" stroke="' + c + '"' + ICON_ATTR +
    '><circle cx="8" cy="8" r="6.2"/><path d="M10 6c-.4-.8-1.2-1.2-2-1.2-1.2 0-2 .6-2 1.5 0 2 4 1 4 3 0 .9-.9 1.5-2 1.5-.9 0-1.7-.4-2-1.2M8 3.8v8.4"/></g>',
}

// ---- Rings style: a progress ring with the icon inside, then the percent and the time -------------

const isRings = () => choice('style', 'pills') === 'rings'
const itemGap = () => (isRings() ? 26 : 8)

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
// A pill with a bar: icon, label, bar (optional pace marker), percent, optional "| icon tail".
// Compact layout keeps only the icon and the percent. `warn` forces the alert color.
function barPill(x, o) {
  if (isRings()) return ringItem(x, o)
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
  if (isRings()) return ringStat(x, icon, color, str)
  const w = 14 + 16 + 8 + str.length * CW + 14
  return { w, svg: pillBg(x, w, color) + ICONS[icon](x + 14, color) + text(x + 14 + 24, str, TEXT) }
}

// "cache 42m", or "cache 42m · kept 5h 10m" while keep-warm is holding it
function cacheText(now) {
  const label = cacheLabel(now)
  const kept = keptLeft(now)
  if (isCompact()) return label + (kept ? ' ⟳' : '')
  return 'cache ' + label + (kept ? ' · kept ' + formatLeft(kept) : '')
}

function cachePill(x, now) {
  if (cacheLabel(now) === 'cold') return statPill(x, 'snow', COLORS.cold, isCompact() ? 'cold' : 'cache cold')
  return statPill(x, 'flame', COLORS.warm, cacheText(now))
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
  if (flag('showCache', true)) place((px) => cachePill(px, now))
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
  if (flag('showCache', true)) bits.push(isCompact() ? 'cache ' + cacheLabel(now) : cacheText(now))
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
    case 'showCache':
      return sample([
        (x) => statPill(x, 'flame', COLORS.warm, 'cache 42m'),
        (x) => statPill(x, 'snow', COLORS.cold, 'cache cold'),
      ])
    case 'cacheTtl':
      return sample([(x) => statPill(x, 'flame', COLORS.warm, 'cache ' + formatCacheLeft(cacheTtlMs()))])
    case 'keepWarm':
    case 'keepWarmFor':
      return sample([(x) => statPill(x, 'flame', COLORS.warm,
        'cache 42m · kept ' + formatLeft(KEEP_WARM_MS[choice('keepWarmFor', '6h')] || KEEP_WARM_MS['6h']))])
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
    const savedCache = await $.store.get(CACHE_KEY)
    if (savedCache && typeof savedCache === 'object') {
      cache = { at: savedCache.at || 0, turnAt: savedCache.turnAt || 0, startedAt: savedCache.startedAt || 0, busy: false }
    }
    await refresh($)
    armCache($)
    $.clock.every(60000, () => refresh($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  // A main-thread turn keeps the cache warm while it runs; subagent runs raise no turn.start
  on('turn.start', async ($, e, next) => {
    cache = { ...cache, busy: true }
    if (cacheTimer) cacheTimer.cancel()
    cacheTimer = null
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Add each turn's tokens to the running totals. A main-thread turn that read or wrote
  // the cache restarts its clock.
  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      totals.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      totals.output += u.output_tokens || 0
      totals.cache += u.cache_read_input_tokens || 0
      await $.store.set(TOTALS_KEY, totals)
    }
    await refresh($)
    if (!e.agentId) {
      const touched = u && (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) > 0
      const at = Date.now()
      cache = touched ? { at, turnAt: at, startedAt: sessionStartedAt, busy: false } : { ...cache, busy: false }
      if (touched) {
        keep.stopped = null
        await $.store.set(CACHE_KEY, { at: cache.at, turnAt: cache.turnAt, startedAt: cache.startedAt })
      }
      armCache($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('command.run', { command: 'usage-meter-options' }, async ($) => {
    await openOptions($)
    return { text: 'Usage pills settings opened.' }
  })

  // The settings list: a press flips a checkbox or steps a choice to its next value
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    applyTheme()
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const now = Date.now()
    // One row per option: the control on the left, a sample of its pill on the right
    const rows = SETTINGS.map((s) => {
      const isChoice = Array.isArray(s.choices)
      const current = isChoice ? choice(s.key, s.def) : flag(s.key, s.def)
      let label
      if (isChoice) {
        const hit = s.choices.find((c) => c[0] === current) || s.choices[0]
        label = '▸  ' + s.label + ': ' + hit[1]
      } else {
        label = (current ? '✅  ' : '⬜  ') + s.label
      }
      const button = Button({
        key: s.key,
        label,
        plain: true,
        onPress: async () => {
          if (isChoice) {
            const at = s.choices.findIndex((c) => c[0] === choice(s.key, s.def))
            toggles = { ...toggles, [s.key]: s.choices[(at + 1) % s.choices.length][0] }
          } else {
            toggles = { ...toggles, [s.key]: !flag(s.key, s.def) }
          }
          if (isColorKey(s.key)) isDirty = true
          else await persistToggles($)
          if (s.key === 'showGit') await refreshGit($)
          if (s.key === 'cacheTtl' || s.key === 'keepWarm' || s.key === 'keepWarmFor') {
            keep.stopped = null
            armCache($)
          }
          $.ui.invalidate('ui.render')
        },
      })
      const isOn = isChoice ? true : current
      const sample = Svg ? previewFor(s.key, isOn, now) : null
      let right = Text({ children: [s.key === 'showOptionsButton' ? '⚙' : ''] })
      if (sample) {
        const sampleW = Number(sample.match(/width="([\d.]+)"/)[1])
        right = Svg({ source: sample, alt: s.label, width: sampleW, height: PILL_H })
      }
      const line = Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        children: [button, right],
      })
      if (isChoice && s.key.startsWith('color') && current === 'custom') {
        const hexKey = s.key + 'Hex'
        const field = $.ui.resolve(e).Input({
          key: hexKey,
          label: '      Hex color: ',
          placeholder: '#RRGGBB',
          value: choice(hexKey, ''),
          submitLabel: 'save',
          onSubmit: async (value) => {
            const hex = ('#' + String(value).trim().replace(/^#/, '')).toLowerCase()
            if (!/^#[0-9a-f]{6}$/.test(hex)) return
            toggles = { ...toggles, [hexKey]: hex }
            isDirty = true
            $.ui.invalidate('ui.render')
          },
        })
        return Box({ flexDirection: 'column', children: [line, field] })
      }
      return line
    })
    const sections = GROUPS.map((title, g) =>
      Box({
        flexDirection: 'column',
        gap: 1,
        children: [
          Text({ bold: true, children: [title.toUpperCase()] }),
          ...SETTINGS.map((s, i) => (s.group === g ? rows[i] : null)).filter(Boolean),
        ],
      }),
    )
    return Box({
      flexDirection: 'column',
      gap: 2,
      paddingY: 1,
      children: [
        Text({ dimColor: true, children: ['Click an option to change it. Color changes show right away; Save keeps them, Cancel undoes them.'] }),
        ...sections,
        ...(isDirty ? [Box({
          flexDirection: 'row',
          columnGap: 2,
          alignItems: 'center',
          children: [
            Button({
              key: 'save',
              label: 'Save',
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
        })] : []),
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
