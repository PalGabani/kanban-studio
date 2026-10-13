export const stages = ['Backlog', 'To do', 'In progress', 'Review', 'Done'] as const

export type Stage = (typeof stages)[number]
export type Priority = 'Urgent' | 'High' | 'Medium' | 'Low'
export type IssueType = 'Task' | 'Story' | 'Bug'

export type Comment = {
  id: string
  author: string
  body: string
  createdAt: string
}

export type Task = {
  id: string
  key?: string
  issueType?: IssueType
  assigneeId?: string | null
  title: string
  description: string
  stage: Stage
  priority: Priority
  assignee: string
  startDate?: string
  dueDate: string
  labels: string[]
  comments: Comment[]
}

export type Project = {
  id: string
  key?: string
  issueCounter?: number
  organizationId?: string
  name: string
  description: string
  color: string
  tasks: Task[]
}

export type Member = {
  id?: string
  name: string
  initials: string
  color: string
  email?: string
  role?: 'owner' | 'admin' | 'member'
  projectIds?: string[]
  openIssues?: number
  completedIssues?: number
  overdueIssues?: number
}

export const members: Member[] = [
  { name: 'Alex Morgan', initials: 'AM', color: 'indigo' },
  { name: 'Jamie Chen', initials: 'JC', color: 'peach' },
  { name: 'Sam Rivera', initials: 'SR', color: 'blue' },
  { name: 'Taylor Kim', initials: 'TK', color: 'green' },
  { name: 'Unassigned', initials: '—', color: 'gray' },
]

export const priorityRank: Record<Priority, number> = {
  Urgent: 0,
  High: 1,
  Medium: 2,
  Low: 3,
}
