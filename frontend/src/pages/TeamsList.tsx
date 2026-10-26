import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import type { TeamSummary } from '../types'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'

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

export default function TeamsList() {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Create / edit modal state.
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<TeamSummary | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete state.
  const [deleting, setDeleting] = useState<TeamSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      const data = await api.listTeams()
      setTeams(data)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load teams.')
      setTeams([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate(): void {
    setName('')
    setDescription('')
    setActive(true)
    setFormError(null)
    setShowCreate(true)
  }

  function openEdit(team: TeamSummary): void {
    setEditing(team)
    setName(team.name)
    setDescription(team.description)
    setActive(team.active)
    setFormError(null)
  }

  function closeForm(): void {
    setShowCreate(false)
    setEditing(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setFormError(null)
    setSaving(true)
    try {
      if (editing) {
        await api.updateTeam(editing.id, { name, description, active })
      } else {
        await api.createTeam({ name, description })
      }
      closeForm()
      await load()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save team.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleting) return
    setDeleteError(null)
    setDeleteBusy(true)
    try {
      await api.deleteTeam(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete team.')
    } finally {
      setDeleteBusy(false)
    }
  }

  const formOpen = showCreate || editing !== null

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Teams</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage teams, their supervisors, and agents.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          Create team
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {loadError}
        </div>
      )}

      {teams === null && !loadError && (
        <p className="mt-8 text-sm text-slate-500">Loading teams…</p>
      )}

      {teams !== null && teams.length === 0 && !loadError && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm text-slate-500">No teams yet. Create your first team to get started.</p>
        </div>
      )}

      {teams !== null && teams.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="mt-6 hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table data-voice="teams-table" className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Supervisor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Agents
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teams.map((team) => (
                  <tr key={team.id} data-voice={`team-row-${team.id}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/teams/${team.id}`}
                        className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                      >
                        {team.name}
                      </Link>
                      {team.description && (
                        <p className="mt-0.5 text-xs text-slate-500">{team.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {team.supervisor ? (
                        team.supervisor.name
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{team.agent_count}</td>
                    <td className="px-4 py-3">
                      <StatusBadge active={team.active} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(team)}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(team)}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div data-voice="teams-table" className="mt-6 space-y-3 md:hidden">
            {teams.map((team) => (
              <div
                key={team.id}
                data-voice={`team-row-${team.id}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/teams/${team.id}`}
                    className="font-semibold text-indigo-600 hover:underline"
                  >
                    {team.name}
                  </Link>
                  <StatusBadge active={team.active} />
                </div>
                {team.description && (
                  <p className="mt-1 text-sm text-slate-500">{team.description}</p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Supervisor</dt>
                    <dd className="text-slate-700">
                      {team.supervisor ? team.supervisor.name : 'Unassigned'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Agents</dt>
                    <dd className="text-slate-700">{team.agent_count}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(team)}
                    className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(team)}
                    className="flex-1 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      <Modal open={formOpen} title={editing ? 'Edit team' : 'Create team'} onClose={closeForm}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {formError}
            </div>
          )}
          <div>
            <label htmlFor="team-name" className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              id="team-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div>
            <label
              htmlFor="team-description"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Description
            </label>
            <textarea
              id="team-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
              />
              Active
            </label>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create team'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete team"
        message={
          deleteError
            ? deleteError
            : `Delete "${deleting?.name}"? This cannot be undone.`
        }
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleting(null)
          setDeleteError(null)
        }}
      />
    </div>
  )
}
