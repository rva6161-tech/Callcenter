import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type {
  Assignment,
  Schedule as ScheduleType,
  ScheduleStatus,
  ShiftType,
  TeamSummary,
} from '../types'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { addDays, mondayOf, parseISO, toISODate } from '../lib/dateUtils'

// --- Date helpers (local-time, no TZ shifting) ---

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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

function weekdayShort(s: string): string {
  return WEEKDAYS[parseISO(s).getDay()]
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

/** Human-friendly "published at" label from an ISO timestamp. */
function formatPublishedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${date}, ${hh}:${mm}`
}

// --- Shift type colors ---

const SHIFT_COLORS = [
  'bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200',
  'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200',
  'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200',
  'bg-sky-100 text-sky-800 border-sky-200 hover:bg-sky-200',
  'bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200',
  'bg-violet-100 text-violet-800 border-violet-200 hover:bg-violet-200',
  'bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-200',
  'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200',
]

function StatusBadge({ status }: { status: ScheduleStatus }) {
  const map: Record<ScheduleStatus, { label: string; cls: string }> = {
    draft: {
      label: 'Draft',
      cls: 'bg-amber-50 text-amber-700',
    },
    published: {
      label: 'Published',
      cls: 'bg-emerald-50 text-emerald-700',
    },
    none: {
      label: 'Not created yet',
      cls: 'bg-slate-100 text-slate-600',
    },
  }
  const { label, cls } = map[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

type Notice = { kind: 'warning' | 'error' | 'success'; messages: string[] }

interface EditingCell {
  agentId: number
  agentName: string
  date: string
}

export default function Schedule() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Admin picks a team; supervisor is locked to their own.
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [teamId, setTeamId] = useState<number | null>(
    isAdmin ? null : (user?.team_id ?? null),
  )

  const [weekStart, setWeekStart] = useState<string>(() => toISODate(mondayOf(new Date())))

  const [schedule, setSchedule] = useState<ScheduleType | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [cellBusy, setCellBusy] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)

  // Load the team list for the admin selector.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    void (async () => {
      try {
        const data = await api.listTeams()
        if (cancelled) return
        setTeams(data)
        // Auto-select the first team so the grid is immediately useful.
        setTeamId((prev) => (prev === null && data.length > 0 ? data[0].id : prev))
      } catch {
        // Non-critical; the selector just stays empty.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  const load = useCallback(async (): Promise<void> => {
    if (teamId === null) {
      setSchedule(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api.getSchedule(teamId, weekStart)
      setSchedule(data)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load the schedule.')
      setSchedule(null)
    } finally {
      setLoading(false)
    }
  }, [teamId, weekStart])

  useEffect(() => {
    void load()
  }, [load])

  // Map shift_type_id -> color class (by position in the team's shift types).
  const shiftColorById = useMemo(() => {
    const map = new Map<number, string>()
    schedule?.shift_types.forEach((st, i) => {
      map.set(st.id, SHIFT_COLORS[i % SHIFT_COLORS.length])
    })
    return map
  }, [schedule])

  const shiftById = useMemo(() => {
    const map = new Map<number, ShiftType>()
    schedule?.shift_types.forEach((st) => map.set(st.id, st))
    return map
  }, [schedule])

  // Lookup assignment by "agentId|date".
  const assignmentByCell = useMemo(() => {
    const map = new Map<string, Assignment>()
    schedule?.assignments.forEach((a) => map.set(`${a.agent_id}|${a.work_date}`, a))
    return map
  }, [schedule])

  function cellKey(agentId: number, date: string): string {
    return `${agentId}|${date}`
  }

  const currentAssignment: Assignment | undefined = editingCell
    ? assignmentByCell.get(cellKey(editingCell.agentId, editingCell.date))
    : undefined

  async function applyAndReload(
    op: () => Promise<string[] | null>,
  ): Promise<void> {
    setCellBusy(true)
    try {
      const warnings = await op()
      setEditingCell(null)
      await load()
      if (warnings && warnings.length > 0) {
        setNotice({ kind: 'warning', messages: warnings })
      } else {
        setNotice(null)
      }
    } catch (err) {
      setEditingCell(null)
      if (err instanceof ApiError && err.status === 409) {
        setNotice({
          kind: 'error',
          messages: ["Can't schedule: overlaps an existing shift."],
        })
      } else {
        setNotice({
          kind: 'error',
          messages: [err instanceof ApiError ? err.message : 'Failed to update the schedule.'],
        })
      }
    } finally {
      setCellBusy(false)
    }
  }

  function pickShift(shiftTypeId: number): void {
    if (!editingCell || teamId === null) return
    const { agentId, date } = editingCell
    void applyAndReload(async () => {
      const res = await api.putAssignment({
        team_id: teamId,
        week_start: weekStart,
        agent_id: agentId,
        work_date: date,
        shift_type_id: shiftTypeId,
        is_day_off: false,
      })
      return res.warnings
    })
  }

  function markDayOff(): void {
    if (!editingCell || teamId === null) return
    const { agentId, date } = editingCell
    void applyAndReload(async () => {
      const res = await api.putAssignment({
        team_id: teamId,
        week_start: weekStart,
        agent_id: agentId,
        work_date: date,
        shift_type_id: null,
        is_day_off: true,
      })
      return res.warnings
    })
  }

  function clearCell(): void {
    if (!currentAssignment) return
    const id = currentAssignment.id
    void applyAndReload(async () => {
      await api.deleteAssignment(id)
      return null
    })
  }

  async function handleCopyLastWeek(): Promise<void> {
    if (teamId === null) return
    setCopyBusy(true)
    setNotice(null)
    try {
      const res = await api.copyLastWeek({ team_id: teamId, week_start: weekStart })
      await load()
      if (res.message) {
        setNotice({ kind: 'warning', messages: [res.message] })
      } else {
        setNotice({
          kind: 'success',
          messages: [`Copied last week: ${res.created} created, ${res.skipped} skipped.`],
        })
      }
    } catch (err) {
      setNotice({
        kind: 'error',
        messages: [err instanceof ApiError ? err.message : 'Failed to copy last week.'],
      })
    } finally {
      setCopyBusy(false)
    }
  }

  async function handlePublish(): Promise<void> {
    if (teamId === null) return
    setPublishBusy(true)
    setNotice(null)
    try {
      await api.publishWeek({ team_id: teamId, week_start: weekStart })
      setConfirmPublish(false)
      await load()
      setNotice({ kind: 'success', messages: ['Week published. Agents can now see it.'] })
    } catch (err) {
      setNotice({
        kind: 'error',
        messages: [err instanceof ApiError ? err.message : 'Failed to publish the week.'],
      })
    } finally {
      setPublishBusy(false)
    }
  }

  async function handleUnpublish(): Promise<void> {
    if (teamId === null) return
    setPublishBusy(true)
    setNotice(null)
    try {
      await api.unpublishWeek({ team_id: teamId, week_start: weekStart })
      setConfirmUnpublish(false)
      await load()
      setNotice({ kind: 'success', messages: ['Week reverted to draft. Agents can no longer see it.'] })
    } catch (err) {
      setNotice({
        kind: 'error',
        messages: [err instanceof ApiError ? err.message : 'Failed to unpublish the week.'],
      })
    } finally {
      setPublishBusy(false)
    }
  }

  function goPrevWeek(): void {
    setWeekStart((w) => addDays(w, -7))
    setNotice(null)
  }

  function goNextWeek(): void {
    setWeekStart((w) => addDays(w, 7))
    setNotice(null)
  }

  // Supervisor with no team assigned can't do anything useful.
  if (!isAdmin && teamId === null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">No team assigned</h2>
        <p className="mt-2 text-sm text-slate-500">
          You aren’t assigned to a team yet, so there’s no schedule to manage.
        </p>
      </div>
    )
  }

  const weekDates = schedule?.week_dates ?? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const noticeStyles: Record<Notice['kind'], string> = {
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Weekly Schedule</h1>
          <p className="mt-1 text-sm text-slate-500">
            Build the weekly shift schedule for your team.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {schedule && (
            <div data-voice="schedule-status" className="flex flex-col items-start gap-0.5">
              <StatusBadge status={schedule.status} />
              {schedule.status === 'published' && schedule.published_at && (
                <span className="text-xs text-slate-400">
                  Published {formatPublishedAt(schedule.published_at)}
                </span>
              )}
            </div>
          )}

          {schedule && schedule.status === 'published' ? (
            <button
              type="button"
              onClick={() => setConfirmUnpublish(true)}
              disabled={publishBusy || loading}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {publishBusy ? 'Working…' : 'Unpublish'}
            </button>
          ) : schedule ? (
            <div className="flex flex-col items-start gap-0.5">
              <button
                type="button"
                onClick={() => setConfirmPublish(true)}
                disabled={publishBusy || loading || schedule.status === 'none'}
                className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {publishBusy ? 'Publishing…' : 'Publish week'}
              </button>
              {schedule.status === 'none' && (
                <span className="text-xs text-slate-400">Add shifts first</span>
              )}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void handleCopyLastWeek()}
            disabled={teamId === null || copyBusy || loading}
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copyBusy ? 'Copying…' : 'Copy last week'}
          </button>
        </div>
      </div>

      {/* Controls: team selector + week navigation */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {isAdmin && (
          <div className="max-w-xs">
            <label htmlFor="team-select" className="mb-1 block text-sm font-medium text-slate-700">
              Team
            </label>
            <select
              id="team-select"
              data-voice="schedule-team-select"
              value={teamId === null ? '' : String(teamId)}
              onChange={(e) => {
                setTeamId(e.target.value === '' ? null : Number(e.target.value))
                setNotice(null)
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="">Select a team…</option>
              {teams.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-voice="week-prev"
            onClick={goPrevWeek}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            aria-label="Previous week"
          >
            ← Prev
          </button>
          <div className="min-w-[11rem] text-center text-sm font-medium text-slate-900">
            {weekRangeLabel(weekStart)}
          </div>
          <button
            type="button"
            data-voice="week-next"
            onClick={goNextWeek}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            aria-label="Next week"
          >
            Next →
          </button>
        </div>
      </div>

      {notice && (
        <div
          role="alert"
          className={`mt-4 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${noticeStyles[notice.kind]}`}
        >
          <div>
            {notice.messages.length === 1 ? (
              <span>{notice.messages[0]}</span>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5">
                {notice.messages.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 opacity-70 transition hover:opacity-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {loadError}
        </div>
      )}

      {loading && !schedule && <p className="mt-8 text-sm text-slate-500">Loading schedule…</p>}

      {!loading && teamId === null && isAdmin && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm text-slate-500">Select a team to view its schedule.</p>
        </div>
      )}

      {schedule && schedule.agents.length === 0 && !loading && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm text-slate-500">
            This team has no agents to schedule yet.
          </p>
        </div>
      )}

      {schedule && schedule.agents.length > 0 && (
        <div data-voice="schedule-grid" className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Agent
                </th>
                {weekDates.map((date) => (
                  <th
                    key={date}
                    className="border-b border-l border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-600"
                  >
                    <div className="uppercase tracking-wide">{weekdayShort(date)}</div>
                    <div className="font-medium text-slate-500">{dayMonth(date)}</div>
                    <div className="mt-0.5 font-normal normal-case text-slate-400">
                      {schedule.day_counts[date] ?? 0} scheduled
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.agents.map((agent) => (
                <tr key={agent.id} className="hover:bg-slate-50/50">
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 align-top">
                    <p className="text-sm font-medium text-slate-900">{agent.name}</p>
                    {agent.job_title && (
                      <p className="text-xs text-slate-400">{agent.job_title}</p>
                    )}
                  </td>
                  {weekDates.map((date) => {
                    const a = assignmentByCell.get(cellKey(agent.id, date))
                    return (
                      <td
                        key={date}
                        className="border-b border-l border-slate-100 p-1.5 text-center align-middle"
                      >
                        <ScheduleCell
                          assignment={a}
                          shift={a?.shift_type_id ? shiftById.get(a.shift_type_id) : undefined}
                          colorClass={
                            a?.shift_type_id ? shiftColorById.get(a.shift_type_id) : undefined
                          }
                          onClick={() =>
                            setEditingCell({ agentId: agent.id, agentName: agent.name, date })
                          }
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cell editor */}
      <Modal
        open={editingCell !== null}
        title={
          editingCell ? `${editingCell.agentName} — ${weekdayShort(editingCell.date)} ${dayMonth(editingCell.date)}` : ''
        }
        onClose={() => {
          if (!cellBusy) setEditingCell(null)
        }}
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assign shift
            </p>
            <div className="grid grid-cols-2 gap-2">
              {schedule?.shift_types.map((st) => {
                const selected = currentAssignment?.shift_type_id === st.id
                const color = shiftColorById.get(st.id) ?? SHIFT_COLORS[0]
                return (
                  <button
                    key={st.id}
                    type="button"
                    disabled={cellBusy}
                    onClick={() => pickShift(st.id)}
                    className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition disabled:opacity-60 ${color} ${
                      selected ? 'ring-2 ring-offset-1 ring-slate-500' : ''
                    }`}
                  >
                    <span className="block">{st.name}</span>
                    <span className="block text-xs font-normal opacity-80">
                      {st.start_time} – {st.end_time}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              disabled={cellBusy}
              onClick={markDayOff}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
                currentAssignment?.is_day_off
                  ? 'border-slate-400 bg-slate-100 text-slate-800 ring-2 ring-slate-400 ring-offset-1'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Day off
            </button>
            {currentAssignment && (
              <button
                type="button"
                disabled={cellBusy}
                onClick={clearCell}
                className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
              >
                Clear
              </button>
            )}
          </div>

          {cellBusy && <p className="text-xs text-slate-400">Saving…</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmPublish}
        title="Publish this week?"
        message="Agents on this team will be able to see this week."
        confirmLabel="Publish"
        busy={publishBusy}
        onConfirm={() => void handlePublish()}
        onCancel={() => {
          if (!publishBusy) setConfirmPublish(false)
        }}
      />

      <ConfirmDialog
        open={confirmUnpublish}
        title="Unpublish this week?"
        message="This week will revert to draft and agents will no longer be able to see it."
        confirmLabel="Unpublish"
        destructive
        busy={publishBusy}
        onConfirm={() => void handleUnpublish()}
        onCancel={() => {
          if (!publishBusy) setConfirmUnpublish(false)
        }}
      />
    </div>
  )
}

function ScheduleCell({
  assignment,
  shift,
  colorClass,
  onClick,
}: {
  assignment: Assignment | undefined
  shift: ShiftType | undefined
  colorClass: string | undefined
  onClick: () => void
}) {
  if (assignment && assignment.shift_type_id && shift) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-md border px-2 py-1.5 text-xs font-medium transition ${
          colorClass ?? SHIFT_COLORS[0]
        }`}
        title={`${shift.name} ${shift.start_time}–${shift.end_time}`}
      >
        <span className="block whitespace-nowrap">{shift.name}</span>
        <span className="block whitespace-nowrap text-[10px] font-normal opacity-80">
          {shift.start_time}–{shift.end_time}
        </span>
      </button>
    )
  }

  if (assignment && assignment.is_day_off) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-md border border-slate-200 bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-200"
      >
        Day off
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add assignment"
      className="w-full rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-sm text-slate-400 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-500"
    >
      +
    </button>
  )
}
