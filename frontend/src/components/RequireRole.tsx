import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../types'

interface RequireRoleProps {
  roles: Role[]
  children: ReactNode
}

/**
 * Guards a route to the given roles. Assumes it is rendered inside a
 * ProtectedRoute, so a user is already present. Users without an allowed
 * role are bounced to the home page.
 */
export default function RequireRole({ roles, children }: RequireRoleProps) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
