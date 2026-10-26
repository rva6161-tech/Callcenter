import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { ManagedUser, TeamAgent, TeamDetail as TeamDetailType, TeamSummary } from '../types'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'

type LoadState = 'loading' | 'ok' | 'forbidden' | 'notfound' | 'error'

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? 'inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700'
          : 'inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600'
      }
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>()
  const teamId = Number(id)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [team, setTeam] = useState<TeamDetailType | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  // Admin-only reference data.
  const [allUsers, setAllUsers] = useState<ManagedUser[]>([])
  const [allTeams, setAllTeams] = useState<TeamSummary[]>([])

  // Supervisor assignment.
  const [savingSupervisor, setSavingSupervisor] = useState(false)
  const [supervisorError, setSupervisorError] = useState<string | null>(null)

  // Add agent.
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addJobTitle, setAddJobTitle] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Edit agent.
  const [editingAgent, setEditingAgent] = useState<TeamAgent | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editJobTitle, setEditJobTitle] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Move agent.
  const [movingAgent, setMovingAgent] = useState<TeamAgent | null>(null)
  const [moveTeamId, setMoveTeamId] = useState<number | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  // Deactivate / reactivate.
  const [deactivating, setDeactivating] = useState<TeamAgent | null>(null)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!Number.isInteger(teamId)) {
      setLoadState('notfound')
      return
    }
    setLoadError(null)
    try {
      const data = await api.getTeam(teamId)
      setTeam(data)
      setLoadState('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setLoadState('forbidden')
      } else if (err instanceof ApiError && err.status === 404) {
        setLoadState('notfound')
      } else {
        setLoadError(err instanceof ApiError ? err.message : 'Failed to load team.')
        setLoadState('error')
      }
    }
  }, [teamId])

  const loadReferenceData = useCallback(async (): Promise<void> => {
    try {
      const [users, teams] = await Promise.all([api.listUsers(), api.listTeams()])
      setAllUsers(users)
      setAllTeams(teams)
    } catch {
      // Reference data is non-critical; the controls just stay empty on failure.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (isAdmin) void loadReferenceData()
  }, [isAdmin, loadReferenceData])

  // Agents cannot view team management at all.
  if (user?.role === 'agent') {
    return <NotAuthorized />
  }

  if (loadState === 'loading') {
    return <p className="text-sm text-slate-500">Loading team…</p>
  }
  if (loadState === 'forbidden') {
    return <NotAuthorized />
  }
  if (loadState === 'notfound') {
    return (
      <StateCard title="Team not found" message="This team doesn’t exist or may have been removed." />
    )
  }
  if (loadState === 'error' || !team) {
    return (
      <StateCard
        title="Something went wrong"
        message={loadError ?? 'Failed to load the team.'}
        retry={load}
      />
    )
  }

  async function handleSupervisorChange(value: string): Promise<void> {
    const supervisorId = value === '' ? null : Number(value)
    setSupervisorError(null)
    setSavingSupervisor(true)
    try {
      await api.updateTeam(teamId, { supervisor_id: supervisorId })
      await load()
    } catch (err) {
      setSupervisorError(err instanceof ApiError ? err.message : 'Failed to update supervisor.')
    } finally {
      setSavingSupervisor(false)
    }
  }

  function openEdit(agent: TeamAgent): void {
    setEditingAgent(agent)
    setEditName(agent.name)
    setEditEmail(agent.email)
    setEditJobTitle(agent.job_title)
    setEditError(null)
  }

  function openMove(agent: TeamAgent): void {
    setMovingAgent(agent)
    setMoveTeamId(null)
    setMoveError(null)
  }

  async function handleAdd(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setAddError(null)
    setAddBusy(true)
    try {
      await api.createUser({
        name: addName,
        email: addEmail,
        job_title: addJobTitle || undefined,
        team_id: teamId,
        role: 'agent',
      })
      setShowAdd(false)
      setAddName('')
      setAddEmail('')
      setAddJobTitle('')
      await load()
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Failed to add agent.')
    } finally {
      setAddBusy(false)
    }
  }

  async function handleEdit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!editingAgent) return
    setEditError(null)
    setEditBusy(true)
    try {
      await api.updateUser(editingAgent.id, {
        name: editName,
        email: editEmail,
        job_title: editJobTitle,
      })
      setEditingAgent(null)
      await load()
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to update agent.')
    } finally {
      setEditBusy(false)
    }
  }

  async function handleMove(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!movingAgent || moveTeamId === null) return
    setMoveError(null)
    setMoveBusy(true)
    try {
      await api.updateUser(movingAgent.id, { team_id: moveTeamId })
      setMovingAgent(null)
      await load()
    } catch (err) {
      setMoveError(err instanceof ApiError ? err.message : 'Failed to move agent.')
    } finally {
      setMoveBusy(false)
    }
  }

  async function handleToggleActive(agent: TeamAgent, nextActive: boolean): Promise<void> {
    setToggleError(null)
    setToggleBusy(true)
    try {
      await api.updateUser(agent.id, { active: nextActive })
      setDeactivating(null)
      await load()
    } catch (err) {
      setToggleError(err instanceof ApiError ? err.message : 'Failed to update agent status.')
    } finally {
      setToggleBusy(false)
    }
  }

  const otherTeams = allTeams.filter((t) => t.id !== teamId)

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/teams"
          className={isAdmin ? 'text-sm text-indigo-600 hover:underline' : 'hidden'}
        >
          ← Back to teams
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{team.name}</h1>
          <StatusBadge active={team.active} />
        </div>
        {team.description && <p className="mt-1 text-sm text-slate-600">{team.description}</p>}
      </div>

      {/* Supervisor section */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Supervisor</h2>
        {supervisorError && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {supervisorError}
          </div>
        )}
        <div className="mt-3">
          {team.supervisor ? (
            <p className="text-sm text-slate-700">
              <span className="font-medium">{team.supervisor.name}</span>{' '}
              <span className="text-slate-500">({team.supervisor.email})</span>
            </p>
          ) : (
            <p className="text-sm text-slate-400">Unassigned</p>
          )}

          {isAdmin && (
            <div className="mt-3 max-w-sm">
              <label
                htmlFor="supervisor-select"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Assign supervisor
              </label>
              <select
                id="supervisor-select"
                value={team.supervisor ? String(team.supervisor.id) : ''}
                disabled={savingSupervisor}
                onChange={(e) => void handleSupervisorChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
              >
                <option value="">— Unassigned —</option>
                {allUsers.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name} ({u.role}) — {u.email}
                  </option>
                ))}
              </select>
              {savingSupervisor && <p className="mt-1 text-xs text-slate-400">Saving…</p>}
            </div>
          )}
        </div>
      </section>

      {/* Agents section */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Agents <span className="text-slate-400">({team.agents.length})</span>
          </h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setAddError(null)
                setShowAdd(true)
              }}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              Add agent
            </button>
          )}
        </div>

        {toggleError && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {toggleError}
          </div>
        )}

        {team.agents.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No agents in this team yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {team.agents.map((agent) => (
              <li
                key={agent.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{agent.name}</p>
                    {!agent.active && <StatusBadge active={false} />}
                  </div>
                  <p className="text-sm text-slate-500">{agent.email}</p>
                  {agent.job_title && (
                    <p className="text-xs text-slate-400">{agent.job_title}</p>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(agent)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => openMove(agent)}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Move
                    </button>
                    {agent.active ? (
                      <button
                        type="button"
                        onClick={() => {
                          setToggleError(null)
                          setDeactivating(agent)
                        }}
                        className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(agent, true)}
                        disabled={toggleBusy}
                        className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add agent modal */}
      <Modal open={showAdd} title="Add agent" onClose={() => setShowAdd(false)}>
        <form onSubmit={handleAdd} className="space-y-4">
          {addError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {addError}
            </div>
          )}
          <Field id="add-name" label="Name" value={addName} onChange={setAddName} required />
          <Field
            id="add-email"
            label="Email"
            type="email"
            value={addEmail}
            onChange={setAddEmail}
            required
          />
          <Field
            id="add-job"
            label="Job title"
            value={addJobTitle}
            onChange={setAddJobTitle}
          />
          <p className="text-xs text-slate-400">
            The agent is created with the default password and can sign in immediately.
          </p>
          <FormActions
            busy={addBusy}
            submitLabel="Add agent"
            onCancel={() => setShowAdd(false)}
          />
        </form>
      </Modal>

      {/* Edit agent modal */}
      <Modal
        open={editingAgent !== null}
        title="Edit agent"
        onClose={() => setEditingAgent(null)}
      >
        <form onSubmit={handleEdit} className="space-y-4">
          {editError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {editError}
            </div>
          )}
          <Field id="edit-name" label="Name" value={editName} onChange={setEditName} required />
          <Field
            id="edit-email"
            label="Email"
            type="email"
            value={editEmail}
            onChange={setEditEmail}
            required
          />
          <Field
            id="edit-job"
            label="Job title"
            value={editJobTitle}
            onChange={setEditJobTitle}
          />
          <FormActions
            busy={editBusy}
            submitLabel="Save changes"
            onCancel={() => setEditingAgent(null)}
          />
        </form>
      </Modal>

      {/* Move agent modal */}
      <Modal
        open={movingAgent !== null}
        title={`Move ${movingAgent?.name ?? 'agent'}`}
        onClose={() => setMovingAgent(null)}
      >
        <form onSubmit={handleMove} className="space-y-4">
          {moveError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {moveError}
            </div>
          )}
          <div>
            <label htmlFor="move-team" className="mb-1 block text-sm font-medium text-slate-700">
              Destination team
            </label>
            <select
              id="move-team"
              value={moveTeamId === null ? '' : String(moveTeamId)}
              onChange={(e) => setMoveTeamId(e.target.value === '' ? null : Number(e.target.value))}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="">Select a team…</option>
              {otherTeams.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
            {otherTeams.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">No other teams available.</p>
            )}
          </div>
          <FormActions
            busy={moveBusy}
            submitLabel="Move agent"
            onCancel={() => setMovingAgent(null)}
            disabled={moveTeamId === null}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivating !== null}
        title="Deactivate agent"
        message={`Deactivate ${deactivating?.name ?? 'this agent'}? They will no longer be schedulable until reactivated.`}
        confirmLabel="Deactivate"
        destructive
        busy={toggleBusy}
        onConfirm={() => {
          if (deactivating) void handleToggleActive(deactivating, false)
        }}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  )
}

function NotAuthorized() {
  return (
    <StateCard
      title="Not authorized"
      message="You don’t have permission to view this team."
    />
  )
}

function StateCard({
  title,
  message,
  retry,
}: {
  title: string
  message: string
  retry?: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <div className="mt-4 flex justify-center gap-3">
        <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
          Go home
        </Link>
        {retry && (
          <button
            type="button"
            onClick={retry}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
    </div>
  )
}

function FormActions({
  busy,
  submitLabel,
  onCancel,
  disabled = false,
}: {
  busy: boolean
  submitLabel: string
  onCancel: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex justify-end gap-3 pt-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy || disabled}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}
