import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ConversationProvider,
  useConversation,
  type ClientTools,
} from '@elevenlabs/react'
import type { MessagePayload } from '@elevenlabs/react'
import { api, ApiError } from '../lib/api'
import { addDays, mondayOf, toISODate } from '../lib/dateUtils'
import {
  guidedActivate,
  highlight as guideHighlight,
  moveCursorTo,
  pointAt,
  resolveTargetSelectors,
} from '../lib/guide'
import type { TeamSummary } from '../types'

// --- Small param readers so the client-tool handlers stay fully typed ---

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** Turn any thrown value into a short, human-readable string for the agent. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

/** Monday of (current week + weekOffset weeks), as a 'YYYY-MM-DD' string. */
function weekStartFor(weekOffset: number | undefined): string {
  const monday = toISODate(mondayOf(new Date()))
  return addDays(monday, (weekOffset ?? 0) * 7)
}

/** Maps a navigate() destination to the nav anchor the guided cursor clicks. */
const NAV_VOICE: Record<string, string> = {
  home: 'nav-home',
  teams: 'nav-teams',
  shift_types: 'nav-shift-types',
  my_schedule: 'nav-my-schedule',
  team_detail: 'nav-teams',
  schedule: 'nav-schedule',
}

/** A single line in the live transcript. */
interface TranscriptLine {
  id: string
  role: 'user' | 'agent'
  text: string
}

// --- Status presentation ------------------------------------------------

const STATUS_STYLE: Record<string, { label: string; dot: string }> = {
  disconnected: { label: 'Disconnected', dot: 'bg-slate-400' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400 animate-pulse' },
  connected: { label: 'Connected', dot: 'bg-emerald-500' },
  listening: { label: 'Listening', dot: 'bg-emerald-500 animate-pulse' },
  speaking: { label: 'Speaking', dot: 'bg-indigo-500 animate-pulse' },
  error: { label: 'Connection error', dot: 'bg-rose-500' },
}

function MicIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

/**
 * The actual widget. Must live inside a `ConversationProvider`, which
 * `VoiceAssistant` (the default export) supplies.
 */
function AssistantWidget() {
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [draft, setDraft] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [micNote, setMicNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lineSeq = useRef(0)
  // Text the user typed before a session finished connecting — flushed on connect.
  const pendingSend = useRef<string | null>(null)
  const transcriptEnd = useRef<HTMLDivElement | null>(null)

  const addLine = useCallback((role: 'user' | 'agent', text: string) => {
    lineSeq.current += 1
    setLines((prev) => [...prev, { id: `l${lineSeq.current}`, role, text }])
  }, [])

  const handleMessage = useCallback(
    (payload: MessagePayload) => {
      const text = payload.message?.trim()
      if (!text) return
      addLine(payload.role === 'user' ? 'user' : 'agent', text)
    },
    [addLine],
  )

  const conversation = useConversation({
    onMessage: handleMessage,
    onError: (message: string) => setError(message),
    onDisconnect: () => setPreparing(false),
  })

  const { status, isSpeaking, startSession, endSession, sendUserMessage } = conversation

  // --- Client tools the ElevenLabs agent can invoke (exact names) ---------

  const resolveTeamId = useCallback(async (name: string): Promise<number | undefined> => {
    const teams = await api.listTeams()
    const wanted = name.trim().toLowerCase()
    return teams.find((t) => t.name.toLowerCase() === wanted)?.id
  }, [])

  const clientTools: ClientTools = useMemo(
    () => ({
      navigate: async (params) => {
        const destination = readString(params, 'destination')
        const teamName = readString(params, 'team_name')
        const weekOffset = readNumber(params, 'week_offset')

        // Resolve the team up-front so an unknown name fails before we animate.
        let teamId: number | undefined
        if ((destination === 'team_detail' || destination === 'schedule') && teamName) {
          teamId = await resolveTeamId(teamName)
          if (teamId === undefined) return `No team named "${teamName}" was found.`
        }
        if (destination === 'team_detail' && !teamName) {
          return 'Please tell me which team to open.'
        }

        // Visibly drive the matching nav link before routing.
        const navName = destination ? NAV_VOICE[destination] : undefined
        if (navName) {
          await guidedActivate(`[data-voice="${navName}"]`)
        }

        switch (destination) {
          case 'home':
            navigate('/')
            return 'Opened Home.'
          case 'teams':
            navigate('/teams')
            return 'Opened Teams.'
          case 'shift_types':
            navigate('/shift-types')
            return 'Opened Shift Types.'
          case 'my_schedule':
            navigate(weekOffset ? `/my-schedule?week_offset=${weekOffset}` : '/my-schedule')
            // Not awaited: let the page render while the assistant keeps talking.
            void pointAt('[data-voice="my-schedule-list"]')
            return 'Opened My Schedule.'
          case 'team_detail': {
            navigate(`/teams/${teamId}`)
            return `Opened the ${teamName} team.`
          }
          case 'schedule': {
            const query = new URLSearchParams()
            if (teamId !== undefined) query.set('team_id', String(teamId))
            if (weekOffset) query.set('week_offset', String(weekOffset))
            const qs = query.toString()
            navigate(qs ? `/schedule?${qs}` : '/schedule')
            // Highlight the grid once it has rendered (pointAt polls for it).
            void pointAt('[data-voice="schedule-grid"]')
            return 'Opened the Schedule.'
          }
          default:
            return `Unknown destination "${destination ?? ''}".`
        }
      },

      // Guided highlight: move the cursor to the resolved target and pulse it.
      highlight: async (params) => {
        const target = readString(params, 'target')
        if (!target) return 'Please tell me what to highlight.'
        let teams: TeamSummary[] = []
        try {
          teams = await api.listTeams()
        } catch {
          // Non-critical: team-name fuzzy matching just won't be available.
        }
        const selectors = resolveTargetSelectors(target, teams)
        if (selectors.length === 0) return 'ok'
        await moveCursorTo(selectors)
        await guideHighlight(selectors)
        return 'ok'
      },

      get_teams: async () => {
        try {
          const teams = await api.listTeams()
          return JSON.stringify(
            teams.map((t) => ({
              name: t.name,
              agent_count: t.agent_count,
              supervisor: t.supervisor?.name ?? null,
            })),
          )
        } catch (err) {
          return errorText(err)
        }
      },

      get_team: async (params) => {
        const teamName = readString(params, 'team_name')
        if (!teamName) return 'Please tell me which team.'
        const id = await resolveTeamId(teamName)
        if (id === undefined) return `No team named "${teamName}" was found.`
        try {
          const team = await api.getTeam(id)
          return JSON.stringify({
            name: team.name,
            supervisor: team.supervisor?.name ?? null,
            agents: team.agents.map((a) => ({ name: a.name, job_title: a.job_title })),
          })
        } catch (err) {
          return errorText(err)
        }
      },

      get_schedule: async (params) => {
        const teamName = readString(params, 'team_name')
        if (!teamName) return 'Please tell me which team.'
        const id = await resolveTeamId(teamName)
        if (id === undefined) return `No team named "${teamName}" was found.`
        const weekStart = weekStartFor(readNumber(params, 'week_offset'))
        try {
          const schedule = await api.getSchedule(id, weekStart)
          return JSON.stringify({
            week_start: schedule.week_start,
            status: schedule.status,
            day_counts: schedule.day_counts,
            assignments_count: schedule.assignments.length,
          })
        } catch (err) {
          return errorText(err)
        }
      },

      get_my_schedule: async (params) => {
        const weekStart = weekStartFor(readNumber(params, 'week_offset'))
        try {
          const mine = await api.getMySchedule(weekStart)
          return JSON.stringify({
            week_start: mine.week_start,
            published: mine.published,
            shifts: mine.shifts.map((s) => ({
              work_date: s.work_date,
              shift: s.is_day_off ? 'Day off' : (s.shift_type?.name ?? 'Unassigned'),
            })),
          })
        } catch (err) {
          return errorText(err)
        }
      },
    }),
    [navigate, resolveTeamId],
  )

  // --- Session lifecycle --------------------------------------------------

  const connect = useCallback(
    async (textOnly: boolean): Promise<boolean> => {
      setError(null)
      setPreparing(true)
      try {
        const { signed_url } = await api.getAssistantSignedUrl()
        startSession({ signedUrl: signed_url, connectionType: 'websocket', clientTools, textOnly })
        return true
      } catch (err) {
        setError(errorText(err))
        return false
      } finally {
        setPreparing(false)
      }
    },
    [clientTools, startSession],
  )

  const startVoice = useCallback(async () => {
    setMicNote(null)
    // Request the microphone only when the user explicitly starts a voice session.
    try {
      const media = navigator.mediaDevices
      if (!media?.getUserMedia) {
        throw new Error('insecure-context')
      }
      const stream = await media.getUserMedia({ audio: true })
      // We only needed the permission prompt; the SDK opens its own stream.
      stream.getTracks().forEach((track) => track.stop())
    } catch {
      setMicNote('Microphone needs HTTPS — you can still type commands below.')
      return
    }
    await connect(false)
  }, [connect])

  const stop = useCallback(() => {
    endSession()
  }, [endSession])

  const sendText = useCallback(async () => {
    const text = draft.trim()
    if (!text) return
    addLine('user', text)
    setDraft('')
    if (status === 'connected') {
      sendUserMessage(text)
      return
    }
    // Not connected yet: open a text-only session and flush once connected.
    pendingSend.current = text
    const ok = await connect(true)
    if (!ok) {
      pendingSend.current = null
      setError((prev) => prev ?? 'Could not reach the assistant.')
    }
  }, [draft, status, sendUserMessage, addLine, connect])

  // Flush any queued text message as soon as the session connects.
  useEffect(() => {
    if (status === 'connected' && pendingSend.current) {
      sendUserMessage(pendingSend.current)
      pendingSend.current = null
    }
  }, [status, sendUserMessage])

  // Keep the transcript scrolled to the newest line.
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  const displayStatus =
    status === 'connected' ? (isSpeaking ? 'speaking' : 'listening') : status
  const style = STATUS_STYLE[displayStatus] ?? STATUS_STYLE.disconnected
  const isConnected = status === 'connected'
  const isBusy = preparing || status === 'connecting'

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div className="flex h-[32rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Assistant</p>
                <p className="text-xs text-slate-500">{style.label}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            {isConnected ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-200"
              >
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-600" aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startVoice()}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
              >
                <MicIcon className="h-4 w-4" />
                {isBusy ? 'Starting…' : 'Start voice'}
              </button>
            )}
            {isConnected && (
              <span className="text-xs text-slate-500">
                {isSpeaking ? 'Assistant is speaking' : 'Listening — talk or type'}
              </span>
            )}
          </div>

          {/* Transcript */}
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {lines.length === 0 ? (
              <p className="mt-6 text-center text-sm text-slate-400">
                Ask me to open a page or tell you about teams and schedules.
              </p>
            ) : (
              lines.map((line) => (
                <div
                  key={line.id}
                  className={line.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={[
                      'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                      line.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-800',
                    ].join(' ')}
                  >
                    {line.text}
                  </div>
                </div>
              ))
            )}
            <div ref={transcriptEnd} />
          </div>

          {/* Notices */}
          {(micNote || error) && (
            <div className="space-y-1 px-4 pb-1">
              {micNote && (
                <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">{micNote}</p>
              )}
              {error && (
                <p className="rounded-md bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">{error}</p>
              )}
            </div>
          )}

          {/* Text fallback */}
          <form
            className="flex items-center gap-2 border-t border-slate-200 px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              void sendText()
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a command…"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <button
              type="submit"
              disabled={!draft.trim() || isBusy}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* Floating toggle button */}
      <button
        type="button"
        aria-label={open ? 'Hide assistant' : 'Open assistant'}
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200"
      >
        {open ? (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <MicIcon className="h-6 w-6" />
        )}
      </button>
    </div>
  )
}

/** Floating voice/text assistant, mounted once for authenticated users. */
export default function VoiceAssistant() {
  return (
    <ConversationProvider>
      <AssistantWidget />
    </ConversationProvider>
  )
}
