import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../types'

const ROLE_CAPABILITIES: Record<Role, { label: string; description: string }> = {
  admin: {
    label: 'Administrator',
    description: 'Manage all teams, agents, and schedules across the organization.',
  },
  supervisor: {
    label: 'Supervisor',
    description: 'Manage your own team and build their shift schedule.',
  },
  agent: {
    label: 'Agent',
    description: 'View your personal shift schedule.',
  },
}

export default function Home() {
  const { user } = useAuth()

  // ProtectedRoute guarantees a user, but guard for type-safety.
  if (!user) {
    return null
  }

  const capability = ROLE_CAPABILITIES[user.role]

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium capitalize text-indigo-700">
        {capability.label}
      </span>
      <h2 className="mt-3 text-xl font-semibold text-slate-900">
        Welcome, {user.name.split(' ')[0]} 👋
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        As {user.role === 'agent' ? 'an' : 'a'} <span className="font-medium">{user.role}</span>,
        you&apos;ll be able to {capability.description.charAt(0).toLowerCase()}
        {capability.description.slice(1)}
      </p>

      {user.role === 'admin' && (
        <Link
          to="/teams"
          className="mt-4 inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          Manage teams
        </Link>
      )}
      {user.role === 'supervisor' && user.team_id !== null && (
        <Link
          to={`/teams/${user.team_id}`}
          className="mt-4 inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          View my team
        </Link>
      )}
      {user.role === 'agent' && (
        <Link
          to="/my-schedule"
          className="mt-4 inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          View my schedule
        </Link>
      )}
    </section>
  )
}
