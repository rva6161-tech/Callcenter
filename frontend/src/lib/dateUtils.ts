// Pure, timezone-safe date helpers for the weekly schedule grid.
// Extracted from Schedule.tsx so the logic is unit-testable in isolation.
// All functions operate in LOCAL time and avoid any UTC/ISO parsing shift.

/** Parse a 'YYYY-MM-DD' string into a local-time Date (no TZ shift). */
export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Format a Date as 'YYYY-MM-DD' in local time. */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Monday (ISO week start) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = date.getDay() // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}

/** Add `days` to a 'YYYY-MM-DD' string, returning a 'YYYY-MM-DD' string. */
export function addDays(s: string, days: number): string {
  const d = parseISO(s)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}
