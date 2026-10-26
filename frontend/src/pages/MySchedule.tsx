import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { MySchedule as MyScheduleType, MyScheduleShift } from '../types'

// --- Date helpers (local-time, no TZ shifting) ---

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Monday (ISO week start) of the week containing `d`. */
function mondayOf(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = date.getDay() // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}

function addDays(s: string, days: number): string {
  const d = parseISO(s)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

function weekdayLong(s: string): string {
  return WEEKDAYS_LONG[parseISO(s).getDay()]
}

function dayMonth(s: string): string {
  const d = parseISO(s)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

function weekRangeLabel(weekStart: string): string {
  const start = parseISO(weekStart)
  const end = parseISO(addDays(weekStart, 6))
  const startLabel = `${MONTHS[start.getMonth()]} ${start.getDate()}`
  const endLabel = `${MONTHS[end.getMonth()]} ${end.getDate()}`
  return `${startLabel} – ${endLabel}, ${end.getFullYear()}`
}

export default function MySchedule() {
  const [weekStart, setWeekStart] = useState<string>(() => toISODate(mondayOf(new Date())))
  const [data, setData] = useState<MyScheduleType | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.getMySchedule(weekStart)
      setData(res)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load your schedule.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => {
    void load()
  }, [load])

  // Lookup each day's shift by date (empty days are omitted by the API).
  const shiftByDate = useMemo(() => {
    const map = new Map<string, MyScheduleShift>()
    data?.shifts.forEach((s) => map.set(s.work_date, s))
    return map
  }, [data])

  // Always render all 7 days, Mon..Sun.
  const weekDates = data?.week_dates ?? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function goPrevWeek(): void {
    setWeekStart((w) => addDays(w, -7))
  }

  function goNextWeek(): void {
    setWeekStart((w) => addDays(w, 7))
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">My Schedule</h1>
        <p className="mt-1 text-sm text-slate-500">Your shifts for the week.</p>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrevWeek}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          aria-label="Previous week"
        >
          ← Prev
        </button>
        <div className="text-center text-sm font-medium text-slate-900">
          {weekRangeLabel(weekStart)}
        </div>
        <button
          type="button"
          onClick={goNextWeek}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          aria-label="Next week"
        >
          Next →
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {loadError}
        </div>
      )}

      {loading && !data && <p className="mt-8 text-sm text-slate-500">Loading your schedule…</p>}

      {data && !data.published && !loading && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
            🗓️
          </div>
          <h2 className="text-base font-semibold text-slate-900">Not published yet</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">
            This week&apos;s schedule hasn&apos;t been published yet. Check back soon.
          </p>
        </div>
      )}

      {data && data.published && (
        <div data-voice="my-schedule-list" className="mt-6 space-y-3">
          {weekDates.map((date) => (
            <DayCard key={date} date={date} shift={shiftByDate.get(date)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span className="font-medium text-slate-400">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function DayCard({ date, shift }: { date: string; shift: MyScheduleShift | undefined }) {
  const st = shift?.shift_type ?? null
  const isDayOff = shift?.is_day_off ?? false

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{weekdayLong(date)}</p>
          <p className="text-xs text-slate-400">{dayMonth(date)}</p>
        </div>

        {st ? (
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
            {st.name}
          </span>
        ) : isDayOff ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            Day off
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-400">
            No shift
          </span>
        )}
      </div>

      {st && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-slate-800">
            {st.start_time}–{st.end_time}
          </p>
          <div className="mt-1.5 space-y-1">
            {st.break_start && st.break_end && (
              <TimeRow label="Break" value={`${st.break_start}–${st.break_end}`} />
            )}
            {st.lunch_start && st.lunch_end && (
              <TimeRow label="Lunch" value={`${st.lunch_start}–${st.lunch_end}`} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
