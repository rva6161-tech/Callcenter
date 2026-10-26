export type Role = 'admin' | 'supervisor' | 'agent'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  team_id: number | null
}

export interface LoginResponse {
  access_token: string
  token_type: string
  user: User
}

/** Minimal supervisor reference embedded in team payloads. */
export interface SupervisorRef {
  id: number
  name: string
  email: string
}

/** Team as returned by the list endpoint. */
export interface TeamSummary {
  id: number
  name: string
  description: string
  active: boolean
  agent_count: number
  supervisor: SupervisorRef | null
}

/** Agent as embedded in a team detail payload. */
export interface TeamAgent {
  id: number
  name: string
  email: string
  job_title: string
  active: boolean
}

/** Full team detail including its agents. */
export interface TeamDetail {
  id: number
  name: string
  description: string
  active: boolean
  supervisor: SupervisorRef | null
  agents: TeamAgent[]
}

/** A user as managed through the /api/users endpoints. */
export interface ManagedUser {
  id: number
  name: string
  email: string
  role: Role
  job_title: string
  team_id: number | null
  active: boolean
}

export interface CreateTeamBody {
  name: string
  description?: string
}

export interface UpdateTeamBody {
  name?: string
  description?: string
  supervisor_id?: number | null
  active?: boolean
}

/** A shift type / shift template with its daily time windows. Times are "HH:MM". */
export interface ShiftType {
  id: number
  name: string
  start_time: string
  end_time: string
  break_start: string | null
  break_end: string | null
  lunch_start: string | null
  lunch_end: string | null
}

export interface CreateShiftTypeBody {
  name: string
  start_time: string
  end_time: string
  break_start?: string | null
  break_end?: string | null
  lunch_start?: string | null
  lunch_end?: string | null
}

/** Partial update for a shift type. */
export type UpdateShiftTypeBody = Partial<CreateShiftTypeBody>

/** Status of a team's weekly schedule. */
export type ScheduleStatus = 'draft' | 'published' | 'none'

/** Agent as listed in the schedule grid rows. */
export interface ScheduleAgent {
  id: number
  name: string
  job_title: string
}

/** A single cell assignment within a week's schedule. */
export interface Assignment {
  id: number
  agent_id: number
  work_date: string
  shift_type_id: number | null
  is_day_off: boolean
}

/** Full weekly schedule payload for one team. */
export interface Schedule {
  team: { id: number; name: string }
  week_start: string
  week_dates: string[]
  status: ScheduleStatus
  published_at: string | null
  shift_types: ShiftType[]
  agents: ScheduleAgent[]
  assignments: Assignment[]
  day_counts: Record<string, number>
}

export interface PutAssignmentBody {
  team_id: number
  week_start: string
  agent_id: number
  work_date: string
  shift_type_id: number | null
  is_day_off: boolean
}

/** Result of saving an assignment; warnings are non-blocking rest alerts. */
export interface AssignmentResult {
  id: number
  agent_id: number
  work_date: string
  shift_type_id: number | null
  is_day_off: boolean
  warnings: string[]
}

export interface CopyLastWeekBody {
  team_id: number
  week_start: string
}

/** Result of copy-last-week; `message` is set when there was no previous week. */
export interface CopyLastWeekResult {
  created: number
  skipped: number
  status?: ScheduleStatus
  message?: string
}

/** Result of publishing / unpublishing a team's week. */
export interface PublishResult {
  team_id: number
  week_start: string
  status: ScheduleStatus
  published_at: string | null
}

/** A single day in an agent's personal schedule. */
export interface MyScheduleShift {
  work_date: string
  is_day_off: boolean
  shift_type: ShiftType | null
}

/** The current agent's own weekly schedule (published weeks only). */
export interface MySchedule {
  week_start: string
  week_dates: string[]
  published: boolean
  status: ScheduleStatus
  published_at: string | null
  shifts: MyScheduleShift[]
}

/** Response from GET /api/assistant/config. */
export interface AssistantConfig {
  agent_id: string
}

/** Response from POST /api/assistant/signed-url — a short-lived wss URL. */
export interface AssistantSignedUrl {
  signed_url: string
}

export interface CreateUserBody {
  name: string
  email: string
  job_title?: string
  team_id?: number | null
  role?: Role
  password?: string
}

export interface UpdateUserBody {
  name?: string
  email?: string
  job_title?: string
  team_id?: number | null
  active?: boolean
  role?: Role
}
