import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './api'
import type { Member, Project, Task } from './types'

export type OrganizationRole = 'owner' | 'admin' | 'member'

export type WorkspaceUser = {
  id: string
  email: string
  displayName: string
}

export type Organization = {
  id: string
  name: string
  slug: string
  role: OrganizationRole
}

type WorkspacePayload = {
  role: OrganizationRole
  projects: Project[]
  members: Member[]
  invitations: { id: string; email: string; role: Exclude<OrganizationRole, 'owner'>; project_ids: string[]; expires_at: string }[]
}

const selectedOrganizationKey = 'stride-active-organization'

function storedOrganizationId() {
  try {
    return window.localStorage.getItem(selectedOrganizationKey) ?? ''
  } catch (error) {
    console.error('Unable to read the selected organization from browser storage.', error)
    return ''
  }
}

function rememberOrganization(id: string) {
  try {
    window.localStorage.setItem(selectedOrganizationKey, id)
  } catch (error) {
    console.error('Unable to save the selected organization in browser storage.', error)
  }
}

function issuePayload(task: Task) {
  return {
    id: task.id,
    issueType: task.issueType ?? 'Task',
    title: task.title,
    description: task.description,
    stage: task.stage,
    priority: task.priority,
    assigneeId: task.assigneeId ?? null,
    startDate: task.startDate ?? '',
    dueDate: task.dueDate ?? '',
    labels: task.labels,
  }
}

function issueFields(task: Task) {
  return JSON.stringify(issuePayload(task))
}

export function useWorkspace() {
  const [user, setUser] = useState<WorkspaceUser | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [organizationId, setOrganizationId] = useState(storedOrganizationId)
  const [organizationRole, setOrganizationRole] = useState<OrganizationRole | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<WorkspacePayload['invitations']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOrganization = useCallback(async (id: string) => {
    const payload = await apiRequest<WorkspacePayload>(`/api/organizations/${id}/workspace`)
    setOrganizationRole(payload.role)
    setProjects(payload.projects)
    setMembers(payload.members)
    setInvitations(payload.invitations)
  }, [])

  const refresh = useCallback(async (preferredOrganizationId?: string) => {
    const session = await apiRequest<{
      user: WorkspaceUser | null
      organizations: Organization[]
    }>('/api/auth/session')
    setUser(session.user)
    setOrganizations(session.organizations)

    if (!session.user) {
      setOrganizationId('')
      setOrganizationRole(null)
      setProjects([])
      setMembers([])
      setInvitations([])
      return
    }
    const remembered = preferredOrganizationId || storedOrganizationId()
    const selected = session.organizations.find((organization) => organization.id === remembered)
      ?? session.organizations[0]
    if (!selected) {
      setOrganizationId('')
      setOrganizationRole(null)
      setProjects([])
      setMembers([])
      setInvitations([])
      return
    }
    setOrganizationId(selected.id)
    rememberOrganization(selected.id)
    await loadOrganization(selected.id)
  }, [loadOrganization])

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      console.error('Unable to initialize the Kanban Studio workspace.', cause)
      setError(cause instanceof Error ? cause.message : 'Unable to load the workspace.')
    }).finally(() => setLoading(false))
  }, [refresh])

  const run = useCallback(async <T,>(operation: () => Promise<T>) => {
    setError('')
    try {
      return await operation()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The change could not be saved.'
      setError(message)
      throw cause
    }
  }, [])

  const login = useCallback((email: string, password: string) => run(async () => {
    await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    await refresh()
  }), [refresh, run])

  const register = useCallback((input: { email: string; password: string; displayName: string; organizationName: string }) => run(async () => {
    const result = await apiRequest<{ organization: { id: string } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refresh(result.organization.id)
  }), [refresh, run])

  const acceptInvitation = useCallback((input: { token: string; displayName: string; password?: string }) => run(async () => {
    const result = await apiRequest<{ organizationId: string }>('/api/invitations/accept', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refresh(result.organizationId)
  }), [refresh, run])

  const logout = useCallback(() => run(async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' })
    await refresh()
  }), [refresh, run])

  const selectOrganization = useCallback((id: string) => run(async () => {
    const organization = organizations.find((item) => item.id === id)
    if (!organization) throw new Error('Choose an organization you belong to.')
    setOrganizationId(organization.id)
    rememberOrganization(organization.id)
    await loadOrganization(organization.id)
  }), [loadOrganization, organizations, run])

  const refreshWorkspace = useCallback(() => organizationId ? loadOrganization(organizationId) : Promise.resolve(), [loadOrganization, organizationId])

  const createProject = useCallback((input: { name: string; key: string; description: string }) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    const project = await apiRequest<Project>(`/api/organizations/${organizationId}/projects`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refreshWorkspace()
    return project
  }), [organizationId, refreshWorkspace, run])

  const updateProject = useCallback((projectId: string, update: (project: Project) => Project) => {
    const current = projects.find((project) => project.id === projectId)
    if (!current || !organizationId) return Promise.resolve()
    const next = update(current)
    setProjects((items) => items.map((project) => project.id === projectId ? next : project))
    return run(async () => {
      const before = new Map(current.tasks.map((task) => [task.id, task]))
      const after = new Map(next.tasks.map((task) => [task.id, task]))
      for (const task of current.tasks) {
        if (!after.has(task.id)) {
          await apiRequest(`/api/organizations/${organizationId}/issues/${task.id}`, { method: 'DELETE' })
        }
      }
      for (const task of next.tasks) {
        const previous = before.get(task.id)
        if (!previous) {
          const saved = await apiRequest<{ key: string }>(
            `/api/organizations/${organizationId}/projects/${projectId}/issues`,
            { method: 'POST', body: JSON.stringify(issuePayload(task)) },
          )
          task.key = saved.key
        } else if (issueFields(previous) !== issueFields(task)) {
          await apiRequest(`/api/organizations/${organizationId}/issues/${task.id}`, {
            method: 'PATCH',
            body: JSON.stringify(issuePayload(task)),
          })
        }
      }
      await refreshWorkspace()
    }).catch(async (cause: unknown) => {
      await refreshWorkspace()
      throw cause
    })
  }, [organizationId, projects, refreshWorkspace, run])

  const createInvitation = useCallback((input: { email: string; role: 'admin' | 'member'; projectIds: string[] }) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    const invitation = await apiRequest(`/api/organizations/${organizationId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    await refreshWorkspace()
    return invitation
  }), [organizationId, refreshWorkspace, run])

  const updateMember = useCallback((memberId: string, input: { role?: 'admin' | 'member'; projectIds?: string[] }) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    await apiRequest(`/api/organizations/${organizationId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    await refreshWorkspace()
  }), [organizationId, refreshWorkspace, run])

  const removeMember = useCallback((memberId: string) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    await apiRequest(`/api/organizations/${organizationId}/members/${memberId}`, { method: 'DELETE' })
    await refreshWorkspace()
  }), [organizationId, refreshWorkspace, run])

  const cancelInvitation = useCallback((invitationId: string) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    await apiRequest(`/api/organizations/${organizationId}/invitations/${invitationId}`, { method: 'DELETE' })
    await refreshWorkspace()
  }), [organizationId, refreshWorkspace, run])

  const addComment = useCallback((issueId: string, body: string) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    const comment = await apiRequest<{ id: string; createdAt: string }>(`/api/organizations/${organizationId}/issues/${issueId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
    await refreshWorkspace()
    return comment
  }), [organizationId, refreshWorkspace, run])

  const editComment = useCallback((commentId: string, body: string) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    await apiRequest(`/api/organizations/${organizationId}/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    })
    await refreshWorkspace()
  }), [organizationId, refreshWorkspace, run])

  const deleteComment = useCallback((commentId: string) => run(async () => {
    if (!organizationId) throw new Error('Select an organization first.')
    await apiRequest(`/api/organizations/${organizationId}/comments/${commentId}`, { method: 'DELETE' })
    await refreshWorkspace()
  }), [organizationId, refreshWorkspace, run])

  return {
    user,
    organizations,
    organizationId,
    organizationRole,
    projects,
    members,
    invitations,
    loading,
    error,
    setError,
    login,
    register,
    acceptInvitation,
    logout,
    refresh,
    selectOrganization,
    refreshWorkspace,
    createProject,
    updateProject,
    createInvitation,
    updateMember,
    removeMember,
    cancelInvitation,
    addComment,
    editComment,
    deleteComment,
  }
}
