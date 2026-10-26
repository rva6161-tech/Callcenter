import type {
  AssignmentResult,
  AssistantConfig,
  AssistantSignedUrl,
  CopyLastWeekBody,
  CopyLastWeekResult,
  CreateShiftTypeBody,
  CreateTeamBody,
  CreateUserBody,
  LoginResponse,
  ManagedUser,
  MySchedule,
  PublishResult,
  PutAssignmentBody,
  Schedule,
  ShiftType,
  TeamDetail,
  TeamSummary,
  UpdateShiftTypeBody,
  UpdateTeamBody,
  UpdateUserBody,
  User,
} from '../types'

const API_URL = import.meta.env.VITE_API_URL

export const TOKEN_KEY = 'cc_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Raised when the API responds with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  /** Attach the stored bearer token to the request. Defaults to true. */
  auth?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (auth) {
    const token = getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const data: unknown = await res.json()
      if (
        data &&
        typeof data === 'object' &&
        'detail' in data &&
        typeof (data as { detail: unknown }).detail === 'string'
      ) {
        detail = (data as { detail: string }).detail
      }
    } catch {
      // response had no JSON body; keep the generic message
    }
    throw new ApiError(res.status, detail)
  }

  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

export const api = {
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
  },
  me(): Promise<User> {
    return request<User>('/api/auth/me')
  },

  // --- Teams ---
  listTeams(): Promise<TeamSummary[]> {
    return request<TeamSummary[]>('/api/teams')
  },
  getTeam(id: number): Promise<TeamDetail> {
    return request<TeamDetail>(`/api/teams/${id}`)
  },
  createTeam(body: CreateTeamBody): Promise<TeamSummary> {
    return request<TeamSummary>('/api/teams', { method: 'POST', body })
  },
  updateTeam(id: number, body: UpdateTeamBody): Promise<TeamDetail> {
    return request<TeamDetail>(`/api/teams/${id}`, { method: 'PUT', body })
  },
  deleteTeam(id: number): Promise<void> {
    return request<void>(`/api/teams/${id}`, { method: 'DELETE' })
  },

  // --- Users ---
  listUsers(params: { team_id?: number; role?: string; active?: boolean } = {}): Promise<
    ManagedUser[]
  > {
    const query = new URLSearchParams()
    if (params.team_id !== undefined) query.set('team_id', String(params.team_id))
    if (params.role !== undefined) query.set('role', params.role)
    if (params.active !== undefined) query.set('active', String(params.active))
    const qs = query.toString()
    return request<ManagedUser[]>(`/api/users${qs ? `?${qs}` : ''}`)
  },
  createUser(body: CreateUserBody): Promise<ManagedUser> {
    return request<ManagedUser>('/api/users', { method: 'POST', body })
  },
  updateUser(id: number, body: UpdateUserBody): Promise<ManagedUser> {
    return request<ManagedUser>(`/api/users/${id}`, { method: 'PUT', body })
  },

  // --- Shift types ---
  listShiftTypes(): Promise<ShiftType[]> {
    return request<ShiftType[]>('/api/shift-types')
  },
  createShiftType(body: CreateShiftTypeBody): Promise<ShiftType> {
    return request<ShiftType>('/api/shift-types', { method: 'POST', body })
  },
  updateShiftType(id: number, body: UpdateShiftTypeBody): Promise<ShiftType> {
    return request<ShiftType>(`/api/shift-types/${id}`, { method: 'PUT', body })
  },

  // --- Schedule ---
  getSchedule(teamId: number, weekStart: string): Promise<Schedule> {
    const query = new URLSearchParams({ team_id: String(teamId), week_start: weekStart })
    return request<Schedule>(`/api/schedule?${query.toString()}`)
  },
  putAssignment(body: PutAssignmentBody): Promise<AssignmentResult> {
    return request<AssignmentResult>('/api/schedule/assignment', { method: 'PUT', body })
  },
  deleteAssignment(id: number): Promise<void> {
    return request<void>(`/api/schedule/assignment/${id}`, { method: 'DELETE' })
  },
  copyLastWeek(body: CopyLastWeekBody): Promise<CopyLastWeekResult> {
    return request<CopyLastWeekResult>('/api/schedule/copy-last-week', { method: 'POST', body })
  },
  publishWeek(body: { team_id: number; week_start: string }): Promise<PublishResult> {
    return request<PublishResult>('/api/schedule/publish', { method: 'POST', body })
  },
  unpublishWeek(body: { team_id: number; week_start: string }): Promise<PublishResult> {
    return request<PublishResult>('/api/schedule/unpublish', { method: 'POST', body })
  },

  // --- Agent self-service ---
  getMySchedule(weekStart?: string): Promise<MySchedule> {
    const qs = weekStart ? `?${new URLSearchParams({ week_start: weekStart }).toString()}` : ''
    return request<MySchedule>(`/api/my-schedule${qs}`)
  },

  // --- Conversational AI voice assistant ---
  getAssistantConfig(): Promise<AssistantConfig> {
    return request<AssistantConfig>('/api/assistant/config')
  },
  getAssistantSignedUrl(): Promise<AssistantSignedUrl> {
    return request<AssistantSignedUrl>('/api/assistant/signed-url', { method: 'POST' })
  },
}
