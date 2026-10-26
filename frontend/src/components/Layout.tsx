import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import VoiceAssistant from './VoiceAssistant'
import GuidedCursor from './GuidedCursor'

interface NavItem {
  label: string
  to: string
}

/** Stable `data-voice` anchor name the guided-automation layer targets. */
function navVoice(to: string): string {
  if (to === '/') return 'nav-home'
  if (to === '/teams' || to.startsWith('/teams/')) return 'nav-teams'
  if (to === '/schedule') return 'nav-schedule'
  if (to === '/shift-types') return 'nav-shift-types'
  if (to === '/my-schedule') return 'nav-my-schedule'
  return 'nav-home'
}

function navItemsFor(role: string, teamId: number | null): NavItem[] {
  const items: NavItem[] = [{ label: 'Home', to: '/' }]
  if (role === 'admin') {
    items.push({ label: 'Teams', to: '/teams' })
  } else if (role === 'supervisor' && teamId !== null) {
    items.push({ label: 'My Team', to: `/teams/${teamId}` })
  }
  // Scheduling tools are available to admins and supervisors.
  if (role === 'admin' || role === 'supervisor') {
    items.push({ label: 'Schedule', to: '/schedule' })
    items.push({ label: 'Shift Types', to: '/shift-types' })
  }
  // Every role can view their own published schedule (agents especially).
  items.push({ label: 'My Schedule', to: '/my-schedule' })
  return items
}

/** Shared application shell: responsive top nav + the routed page content. */
export default function Layout() {
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  // ProtectedRoute guarantees a user, but guard for type-safety.
  if (!user) {
    return null
  }

  const items = navItemsFor(user.role, user.team_id)

  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    [
      'rounded-md px-3 py-2 text-sm font-medium transition',
      isActive
        ? 'bg-indigo-50 text-indigo-700'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    ].join(' ')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto max-w-5xl px-4">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <Link to="/" className="text-lg font-bold text-slate-900">
                Callcenter Scheduling
              </Link>
              <div className="hidden items-center gap-1 sm:flex">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    data-voice={navVoice(item.to)}
                    className={linkClass}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>

            <div className="hidden items-center gap-4 sm:flex">
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">{user.name}</p>
                <p className="text-xs capitalize text-slate-500">{user.role}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                Logout
              </button>
            </div>

            <button
              type="button"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-200 sm:hidden"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                {menuOpen ? (
                  <path strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path strokeWidth="2" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>

          {menuOpen && (
            <div className="space-y-1 border-t border-slate-200 py-3 sm:hidden">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  data-voice={navVoice(item.to)}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    [
                      'block rounded-md px-3 py-2 text-sm font-medium transition',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    ].join(' ')
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 px-3 pt-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{user.name}</p>
                  <p className="text-xs capitalize text-slate-500">{user.role}</p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>

      {/* Conversational AI assistant — shown for any authenticated user. */}
      <VoiceAssistant />

      {/* Guided-automation overlay — the voice assistant drives this visibly. */}
      <GuidedCursor />
    </div>
  )
}
