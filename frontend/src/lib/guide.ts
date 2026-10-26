/**
 * Guided-automation controller.
 *
 * A tiny framework-agnostic singleton the voice client-tools call imperatively
 * to *visibly* drive the UI: it tweens an on-screen cursor to a target element,
 * pulses a highlight ring around it, and plays a "click" ripple. A single
 * mounted <GuidedCursor /> overlay subscribes via `subscribeGuide` and renders
 * whatever the controller is currently showing.
 *
 * READ-ONLY by contract: this layer only moves the cursor, highlights and plays
 * a cosmetic ripple — it never dispatches real DOM clicks, so it can never
 * trigger data-mutating buttons (publish / delete / save).
 */

// --- Timing (kept snappy so narration lines up) --------------------------

const MOVE_MS = 520
const RING_MS = 1200
const CLICK_MS = 340
/** How long to keep polling for an element that may still be rendering. */
const WAIT_MS = 1400
/** How long the cursor lingers after an action finishes before it fades out. */
const LINGER_MS = 800

// --- Shared state shape the overlay renders ------------------------------

export interface CursorState {
  x: number
  y: number
  visible: boolean
  pressed: boolean
}

export interface RingState {
  key: number
  top: number
  left: number
  width: number
  height: number
  ms: number
}

export interface RippleState {
  key: number
  x: number
  y: number
}

export interface GuideState {
  cursor: CursorState
  ring: RingState | null
  ripple: RippleState | null
}

// --- Internal controller -------------------------------------------------

let seq = 0

const state: GuideState = {
  cursor: {
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
    visible: false,
    pressed: false,
  },
  ring: null,
  ripple: null,
}

const listeners = new Set<(s: GuideState) => void>()

function emit(): void {
  const snapshot: GuideState = {
    cursor: { ...state.cursor },
    ring: state.ring ? { ...state.ring } : null,
    ripple: state.ripple ? { ...state.ripple } : null,
  }
  listeners.forEach((fn) => fn(snapshot))
}

/** Subscribe the overlay; the listener is invoked immediately with the current state. */
export function subscribeGuide(fn: (s: GuideState) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => {
    listeners.delete(fn)
  }
}

// --- Auto-hide / dismissal ------------------------------------------------

let hideTimer: number | null = null

/** Cancel any pending auto-hide so a new action doesn't get yanked away mid-flight. */
function cancelHide(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
}

/** Mark the cursor as not-visible and emit so <GuidedCursor /> fades it out. */
function hideCursor(): void {
  if (!state.cursor.visible) return
  state.cursor = { ...state.cursor, visible: false, pressed: false }
  emit()
}

/**
 * Schedule the cursor to fade out after a short linger. Cancels any previously
 * pending hide first, so rapid consecutive actions re-arm the timer instead of
 * flickering the cursor away between them.
 */
function scheduleHide(delay: number = LINGER_MS): void {
  cancelHide()
  hideTimer = window.setTimeout(() => {
    hideTimer = null
    hideCursor()
  }, delay)
}

/**
 * Immediately dismiss everything the overlay is showing — cursor, highlight ring
 * and click ripple — and cancel any pending auto-hide. Called when the real user
 * interacts (moves/clicks their own pointer) so the fake cursor gets out of the
 * way at once. Cheap no-op when nothing is on screen.
 */
export function dismissGuide(): void {
  if (
    hideTimer === null &&
    !state.cursor.visible &&
    state.ring === null &&
    state.ripple === null
  ) {
    return
  }
  cancelHide()
  let changed = false
  if (state.cursor.visible) {
    state.cursor = { ...state.cursor, visible: false, pressed: false }
    changed = true
  }
  if (state.ring !== null) {
    state.ring = null
    changed = true
  }
  if (state.ripple !== null) {
    state.ripple = null
    changed = true
  }
  if (changed) emit()
}

// --- Helpers -------------------------------------------------------------

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function toSelectors(selectors: string | readonly string[]): string[] {
  return (Array.isArray(selectors) ? selectors : [selectors]) as string[]
}

function firstElement(selectors: readonly string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return null
}

/**
 * Resolve the first matching element, polling briefly so targets that render
 * right after a route change (schedule grid, team rows) are still found.
 */
async function waitForElement(
  selectors: readonly string[],
  timeout = WAIT_MS,
): Promise<HTMLElement | null> {
  const interval = 80
  let waited = 0
  for (;;) {
    const el = firstElement(selectors)
    if (el) return el
    if (waited >= timeout) return null
    await sleep(interval)
    waited += interval
  }
}

function centerOf(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

// --- Public imperative actions -------------------------------------------

/** Smoothly tween the cursor to the centre of `selectors`. Returns false if not found. */
export async function moveCursorTo(selectors: string | readonly string[]): Promise<boolean> {
  const sels = toSelectors(selectors)
  const el = await waitForElement(sels)
  if (!el) return false
  if (prefersReducedMotion()) return true

  cancelHide()
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  await sleep(220) // let the scroll settle before measuring
  const { x, y } = centerOf(el)
  state.cursor = { x, y, visible: true, pressed: false }
  emit()
  await sleep(MOVE_MS)
  scheduleHide()
  return true
}

/** Pulse a highlight ring around `selectors`; it auto-dismisses after `ms`. */
export async function highlight(
  selectors: string | readonly string[],
  ms: number = RING_MS,
): Promise<boolean> {
  const sels = toSelectors(selectors)
  const el = await waitForElement(sels)
  if (!el) return false
  if (prefersReducedMotion()) return true

  cancelHide()
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  await sleep(120)
  const r = el.getBoundingClientRect()
  seq += 1
  const key = seq
  const pad = 6
  state.ring = {
    key,
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
    ms,
  }
  emit()
  window.setTimeout(() => {
    if (state.ring?.key === key) {
      state.ring = null
      emit()
    }
  }, ms)
  await sleep(240) // brief beat so narration lines up; the ring lingers on its own
  scheduleHide()
  return true
}

/** Play a cosmetic "click" ripple at `selectors`. Never dispatches a real click. */
export async function simulateClick(selectors: string | readonly string[]): Promise<boolean> {
  const sels = toSelectors(selectors)
  const el = await waitForElement(sels)
  if (!el) return false
  if (prefersReducedMotion()) return true

  cancelHide()
  const { x, y } = centerOf(el)
  seq += 1
  const key = seq
  state.ripple = { key, x, y }
  state.cursor = { ...state.cursor, x, y, visible: true, pressed: true }
  emit()
  await sleep(CLICK_MS * 0.5)
  state.cursor = { ...state.cursor, pressed: false }
  emit()
  window.setTimeout(() => {
    if (state.ripple?.key === key) {
      state.ripple = null
      emit()
    }
  }, CLICK_MS)
  await sleep(CLICK_MS * 0.5)
  scheduleHide()
  return true
}

/** Convenience: move the cursor to a target and ring it (no click). */
export async function pointAt(selectors: string | readonly string[]): Promise<boolean> {
  const moved = await moveCursorTo(selectors)
  if (!moved) return false
  await highlight(selectors)
  scheduleHide()
  return true
}

/**
 * Full guided "activation": point at the target, ring it, then play the click
 * ripple. Used before a real navigation so the user sees the assistant drive
 * the UI. Returns false if the target was never found.
 */
export async function guidedActivate(selectors: string | readonly string[]): Promise<boolean> {
  const sels = toSelectors(selectors)
  const moved = await moveCursorTo(sels)
  if (!moved) return false
  await highlight(sels)
  await simulateClick(sels)
  scheduleHide()
  return true
}

// --- Friendly-name resolver ----------------------------------------------

export interface NamedTeam {
  id: number
  name: string
}

function voice(name: string): string {
  return `[data-voice="${name}"]`
}

/** Best-effort fuzzy match of a spoken phrase against the loaded team list. */
function matchTeam(phrase: string, teams: readonly NamedTeam[]): NamedTeam | undefined {
  const exact = teams.find((t) => t.name.toLowerCase() === phrase)
  if (exact) return exact
  const mentioned = teams.find((t) => phrase.includes(t.name.toLowerCase()))
  if (mentioned) return mentioned
  if (phrase.length >= 3) {
    const partial = teams.find((t) => t.name.toLowerCase().includes(phrase))
    if (partial) return partial
  }
  return undefined
}

/**
 * Map a friendly target name the agent might pass ("schedule", "teams",
 * "my schedule", a team name, or a raw CSS selector / data-voice name) to an
 * ordered list of candidate selectors. Tolerant: case-insensitive, fuzzy on
 * team names via the loaded team list.
 */
export function resolveTargetSelectors(
  target: string,
  teams: readonly NamedTeam[] = [],
): string[] {
  const raw = target.trim()
  if (raw === '') return []

  // Pass raw CSS selectors straight through.
  if (/^[.#[]/.test(raw)) return [raw]

  const t = raw.toLowerCase()

  if (t.includes('home') || t === 'dashboard') return [voice('nav-home')]
  if (t.includes('shift type') || t.includes('shift-type') || t.includes('shift')) {
    return [voice('shift-types-list'), voice('nav-shift-types')]
  }
  if (t.includes('my schedule') || t.includes('my-schedule') || t.includes('my shift')) {
    return [voice('my-schedule-list'), voice('nav-my-schedule')]
  }
  if (t.includes('schedule') || t.includes('grid') || t.includes('roster')) {
    return [voice('schedule-grid'), voice('nav-schedule')]
  }

  // A team referenced by name -> its row, falling back to the teams table.
  const team = matchTeam(t, teams)
  if (team) return [voice(`team-row-${team.id}`), voice('teams-table')]

  if (t.includes('team')) return [voice('teams-table'), voice('nav-teams')]

  // Last resort: treat the whole string as a data-voice name.
  return [voice(raw)]
}
