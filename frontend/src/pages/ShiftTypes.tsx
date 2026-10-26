import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import type { CreateShiftTypeBody, ShiftType } from '../types'
import Modal from '../components/Modal'

/** Display a time window ("HH:MM – HH:MM") or a dash when either end is missing. */
function timeWindow(from: string | null, to: string | null): string {
  if (!from || !to) return '—'
  return `${from} – ${to}`
}

interface FormState {
  name: string
  start_time: string
  end_time: string
  break_start: string
  break_end: string
  lunch_start: string
  lunch_end: string
}

const EMPTY_FORM: FormState = {
  name: '',
  start_time: '',
  end_time: '',
  break_start: '',
  break_end: '',
  lunch_start: '',
  lunch_end: '',
}

/** Convert an empty string to null; otherwise keep the HH:MM value. */
function orNull(value: string): string | null {
  return value === '' ? null : value
}

export default function ShiftTypes() {
  const [shiftTypes, setShiftTypes] = useState<ShiftType[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ShiftType | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      const data = await api.listShiftTypes()
      setShiftTypes(data)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load shift types.')
      setShiftTypes([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate(): void {
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowCreate(true)
  }

  function openEdit(st: ShiftType): void {
    setEditing(st)
    setForm({
      name: st.name,
      start_time: st.start_time,
      end_time: st.end_time,
      break_start: st.break_start ?? '',
      break_end: st.break_end ?? '',
      lunch_start: st.lunch_start ?? '',
      lunch_end: st.lunch_end ?? '',
    })
    setFormError(null)
  }

  function closeForm(): void {
    setShowCreate(false)
    setEditing(null)
  }

  function setField<K extends keyof FormState>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setFormError(null)
    setSaving(true)
    const body: CreateShiftTypeBody = {
      name: form.name,
      start_time: form.start_time,
      end_time: form.end_time,
      break_start: orNull(form.break_start),
      break_end: orNull(form.break_end),
      lunch_start: orNull(form.lunch_start),
      lunch_end: orNull(form.lunch_end),
    }
    try {
      if (editing) {
        await api.updateShiftType(editing.id, body)
      } else {
        await api.createShiftType(body)
      }
      closeForm()
      await load()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save shift type.')
    } finally {
      setSaving(false)
    }
  }

  const formOpen = showCreate || editing !== null

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Shift Types</h1>
          <p className="mt-1 text-sm text-slate-500">
            Define the shift templates used when building weekly schedules.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          Add shift type
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

      {shiftTypes === null && !loadError && (
        <p className="mt-8 text-sm text-slate-500">Loading shift types…</p>
      )}

      {shiftTypes !== null && shiftTypes.length === 0 && !loadError && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm text-slate-500">
            No shift types yet. Add your first shift type to get started.
          </p>
        </div>
      )}

      {shiftTypes !== null && shiftTypes.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="mt-6 hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table data-voice="shift-types-list" className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Shift hours
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Break
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Lunch
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shiftTypes.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{st.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {timeWindow(st.start_time, st.end_time)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {timeWindow(st.break_start, st.break_end)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {timeWindow(st.lunch_start, st.lunch_end)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(st)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div data-voice="shift-types-list" className="mt-6 space-y-3 md:hidden">
            {shiftTypes.map((st) => (
              <div key={st.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-slate-900">{st.name}</p>
                  <button
                    type="button"
                    onClick={() => openEdit(st)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Shift</dt>
                    <dd className="text-slate-700">{timeWindow(st.start_time, st.end_time)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Break</dt>
                    <dd className="text-slate-700">{timeWindow(st.break_start, st.break_end)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Lunch</dt>
                    <dd className="text-slate-700">{timeWindow(st.lunch_start, st.lunch_end)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        title={editing ? 'Edit shift type' : 'Add shift type'}
        onClose={closeForm}
      >
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
            <label htmlFor="st-name" className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              id="st-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="mb-1 text-sm font-medium text-slate-700">Shift hours</legend>
            <TimeField
              id="st-start"
              label="Start"
              required
              value={form.start_time}
              onChange={(v) => setField('start_time', v)}
            />
            <TimeField
              id="st-end"
              label="End"
              required
              value={form.end_time}
              onChange={(v) => setField('end_time', v)}
            />
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="mb-1 text-sm font-medium text-slate-700">
              Break <span className="font-normal text-slate-400">(optional)</span>
            </legend>
            <TimeField
              id="st-break-start"
              label="Start"
              value={form.break_start}
              onChange={(v) => setField('break_start', v)}
            />
            <TimeField
              id="st-break-end"
              label="End"
              value={form.break_end}
              onChange={(v) => setField('break_end', v)}
            />
          </fieldset>

          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="mb-1 text-sm font-medium text-slate-700">
              Lunch <span className="font-normal text-slate-400">(optional)</span>
            </legend>
            <TimeField
              id="st-lunch-start"
              label="Start"
              value={form.lunch_start}
              onChange={(v) => setField('lunch_start', v)}
            />
            <TimeField
              id="st-lunch-end"
              label="End"
              value={form.lunch_end}
              onChange={(v) => setField('lunch_end', v)}
            />
          </fieldset>

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
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add shift type'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function TimeField({
  id,
  label,
  value,
  onChange,
  required = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </label>
      <input
        id={id}
        type="time"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
    </div>
  )
}
