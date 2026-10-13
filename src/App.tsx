import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDownWideNarrow,
  BookOpen,
  Bug,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Command,
  CircleDot,
  Filter,
  LayoutGrid,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { priorityRank, stages, type IssueType, type Priority, type Project, type Stage, type Task } from './types'
import { AuthScreen } from './AuthScreen'
import { useWorkspace } from './useWorkspace'

const priorities: Priority[] = ['Urgent', 'High', 'Medium', 'Low']
const issueTypes: IssueType[] = ['Task', 'Story', 'Bug']

type WorkspaceView = 'board' | 'timeline' | 'calendar' | 'team'

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function toLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function addCalendarDays(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount)
}

function calendarDayDifference(from: Date, to: Date) {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((toUtc - fromUtc) / 86_400_000)
}

function monthLabel(value: Date) {
  return value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function monthDayCount(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate()
}

function dateLabel(value: string) {
  if (!value) return 'No due date'
  const due = new Date(`${value}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (due.getTime() === today.getTime()) return 'Today'
  if (due.getTime() === tomorrow.getTime()) return 'Tomorrow'
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isOverdue(value: string, stage: Stage) {
  if (!value || stage === 'Done') return false
  return new Date(`${value}T00:00:00`).getTime() < new Date(new Date().toDateString()).getTime()
}

function memberFor(name: string, members: ReturnType<typeof useWorkspace>['members']) {
  return members.find((member) => member.name === name) ?? {
    name: 'Unassigned',
    initials: '—',
    color: 'gray',
  }
}

function issueIcon(type: IssueType) {
  if (type === 'Bug') return <Bug size={13} />
  if (type === 'Story') return <BookOpen size={13} />
  return <CircleDot size={13} />
}

function nextIssueKey(project: Project) {
  const nextNumber = project.issueCounter ?? project.tasks.reduce((max, task) => {
    const suffix = task.key?.match(/-(\d+)$/)
    return suffix ? Math.max(max, Number(suffix[1])) : max
  }, 0) + 1
  return `${project.key ?? 'PROJ'}-${nextNumber}`
}

function App() {
  const workspace = useWorkspace()
  const {
    user,
    organizations,
    organizationId,
    organizationRole,
    projects,
    members,
    invitations,
    loading,
    error: workspaceError,
    setError: setWorkspaceError,
  } = workspace
  const currentUser = user?.displayName ?? ''
  const currentOrganization = organizations.find((organization) => organization.id === organizationId)
  const canManageOrganization = organizationRole === 'owner' || organizationRole === 'admin'
  const currentInitials = members.find((member) => member.id === user?.id)?.initials ?? user?.displayName.slice(0, 2).toUpperCase() ?? ''
  const [activeProjectId, setActiveProjectId] = useState(projects[0]?.id ?? '')
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [taskDraft, setTaskDraft] = useState<Task | null>(null)
  const [taskIsNew, setTaskIsNew] = useState(false)
  const [view, setView] = useState<WorkspaceView>('board')
  const [timelineMonth, setTimelineMonth] = useState(() => monthStart(new Date()))
  const [calendarMonth, setCalendarMonth] = useState(() => monthStart(new Date()))
  const [searchText, setSearchText] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('All priorities')
  const [assigneeFilter, setAssigneeFilter] = useState('Everyone')
  const [stageFilter, setStageFilter] = useState('All stages')
  const [showFilters, setShowFilters] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [projectKeyError, setProjectKeyError] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviteProjectIds, setInviteProjectIds] = useState<string[]>([])
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, { role: 'admin' | 'member'; projectIds: string[] }>>({})
  const [newComment, setNewComment] = useState('')
  const [editingCommentId, setEditingCommentId] = useState('')
  const [editCommentText, setEditCommentText] = useState('')
  const [draggedTaskId, setDraggedTaskId] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)

  const visibleTasks = useMemo(() => {
    if (!activeProject) return []
    const needle = searchText.trim().toLowerCase()
    return activeProject.tasks.filter((task) => {
      const matchesSearch = !needle || [
        task.key ?? '',
        task.title,
        task.description,
        task.assignee,
        ...task.labels,
        ...task.comments.map((comment) => comment.body),
      ].some((text) => text.toLowerCase().includes(needle))
      const matchesPriority = priorityFilter === 'All priorities' || task.priority === priorityFilter
      const matchesAssignee = assigneeFilter === 'Everyone' || task.assignee === assigneeFilter
      const matchesStage = stageFilter === 'All stages' || task.stage === stageFilter
      return matchesSearch && matchesPriority && matchesAssignee && matchesStage
    })
  }, [activeProject, assigneeFilter, priorityFilter, searchText, stageFilter])
  const myTaskCount = projects.reduce(
    (total, project) => total + project.tasks.filter((task) => task.assignee === currentUser && task.stage !== 'Done').length,
    0,
  )
  const timelineDays = useMemo(
    () => Array.from({ length: monthDayCount(timelineMonth) }, (_, index) => addCalendarDays(timelineMonth, index)),
    [timelineMonth],
  )
  const calendarDays = useMemo(() => {
    const firstDay = monthStart(calendarMonth)
    const mondayOffset = (firstDay.getDay() + 6) % 7
    const gridStart = addCalendarDays(firstDay, -mondayOffset)
    return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index))
  }, [calendarMonth])
  const projectMembers = members.filter((member) => member.projectIds?.includes(activeProject?.id ?? ''))
  const teamMembers = members.filter((member) =>
    member.role === 'owner' || member.role === 'admin' || member.projectIds?.includes(activeProject?.id ?? ''),
  )

  const updateActiveProject = (update: (project: Project) => Project) => {
    if (!activeProject) return
    void workspace.updateProject(activeProject.id, update)
  }

  const openNewTask = (stage: Stage = 'To do', dueDate = '') => {
    if (!activeProject) {
      startProjectCreation()
      return
    }
    setTaskDraft({
      id: makeId(),
      key: nextIssueKey(activeProject),
      issueType: 'Task',
      title: '',
      description: '',
      stage,
      priority: 'Medium',
      assignee: currentUser,
      assigneeId: projectMembers.find((member) => member.name === currentUser)?.id ?? null,
      dueDate,
      labels: [],
      comments: [],
    })
    setTaskIsNew(true)
    setNewComment('')
  }

  const openTask = (task: Task) => {
    setTaskDraft({ ...task, labels: [...task.labels], comments: [...task.comments] })
    setTaskIsNew(false)
    setNewComment('')
    setEditingCommentId('')
  }

  const saveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!taskDraft || !activeProject || !taskDraft.title.trim()) return
    const savedTask = {
      ...taskDraft,
      assigneeId: projectMembers.find((member) => member.name === taskDraft.assignee)?.id ?? null,
      key: taskDraft.key ?? nextIssueKey(activeProject),
      title: taskDraft.title.trim(),
    }
    updateActiveProject((project) => ({
      ...project,
      issueCounter: taskIsNew ? (project.issueCounter ?? 1) + 1 : project.issueCounter,
      tasks: taskIsNew
        ? [...project.tasks, savedTask]
        : project.tasks.map((task) => task.id === savedTask.id ? savedTask : task),
    }))
    setTaskDraft(null)
  }

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = projectName.trim()
    const key = projectKey.trim().toUpperCase()
    if (!name) return
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
      setProjectKeyError('Use 2–10 letters or numbers, starting with a letter.')
      return
    }
    if (projects.some((project) => project.key?.toUpperCase() === key)) {
      setProjectKeyError('That project key is already in use.')
      return
    }
    try {
      const project = await workspace.createProject({ name, key, description: projectDescription.trim() })
      setActiveProjectId(project.id)
      setProjectDialogOpen(false)
      setProjectName('')
      setProjectKey('')
      setProjectKeyError('')
      setProjectDescription('')
    } catch {
      setProjectKeyError(workspaceError || 'Unable to create the project.')
    }
  }

  const addComment = async () => {
    const body = newComment.trim()
    if (!body || !taskDraft || taskIsNew) return
    try {
      const comment = await workspace.addComment(taskDraft.id, body)
      setTaskDraft((current) => current ? {
        ...current,
        comments: [...current.comments, {
          id: comment.id,
          author: currentUser,
          body,
          createdAt: comment.createdAt,
        }],
      } : null)
      setNewComment('')
    } catch {
      return
    }
  }

  const editComment = (commentId: string) => {
    const comment = taskDraft?.comments.find((item) => item.id === commentId)
    if (!comment) return
    setEditingCommentId(comment.id)
    setEditCommentText(comment.body)
  }

  const saveEditedComment = async (commentId: string) => {
    const body = editCommentText.trim()
    if (!body || !taskDraft) return
    try {
      await workspace.editComment(commentId, body)
      setTaskDraft({
        ...taskDraft,
        comments: taskDraft.comments.map((comment) => comment.id === commentId ? { ...comment, body } : comment),
      })
      setEditingCommentId('')
      setEditCommentText('')
    } catch {
      return
    }
  }

  const deleteComment = async (commentId: string) => {
    if (!taskDraft || !window.confirm('Delete this comment? This cannot be undone.')) return
    try {
      await workspace.deleteComment(commentId)
      setTaskDraft({
        ...taskDraft,
        comments: taskDraft.comments.filter((comment) => comment.id !== commentId),
      })
    } catch {
      return
    }
  }

  const sendInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      await workspace.createInvitation({ email: inviteEmail, role: canManageOrganization && organizationRole === 'owner' ? inviteRole : 'member', projectIds: inviteProjectIds })
      setInviteEmail('')
      setInviteRole('member')
      setInviteProjectIds([])
    } catch {
      return
    }
  }

  const saveMemberAllocation = async (memberId: string) => {
    const draft = allocationDrafts[memberId]
    if (!draft) return
    try {
      await workspace.updateMember(memberId, {
        ...(organizationRole === 'owner' ? { role: draft.role } : {}),
        projectIds: draft.projectIds,
      })
      setAllocationDrafts((current) => {
        const next = { ...current }
        delete next[memberId]
        return next
      })
    } catch {
      return
    }
  }

  const changeOrganization = (id: string) => {
    setActiveProjectId('')
    void workspace.selectOrganization(id)
  }

  const startProjectCreation = () => {
    setProjectName('')
    setProjectKey('')
    setProjectKeyError('')
    setProjectDescription('')
    setProjectDialogOpen(true)
  }

  const deleteTask = () => {
    if (!taskDraft || taskIsNew || !window.confirm('Delete this task? This cannot be undone.')) return
    updateActiveProject((project) => ({
      ...project,
      tasks: project.tasks.filter((task) => task.id !== taskDraft.id),
    }))
    setTaskDraft(null)
  }

  const moveTask = (taskId: string, stage: Stage) => {
    updateActiveProject((project) => ({
      ...project,
      tasks: project.tasks.map((task) => task.id === taskId ? { ...task, stage } : task),
    }))
    setDraggedTaskId('')
  }

  useEffect(() => {
    if (!taskDraft && !projectDialogOpen) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTaskDraft(null)
        setProjectDialogOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [projectDialogOpen, taskDraft])

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      event.preventDefault()
      searchInput.current?.focus()
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  useEffect(() => {
    if (!projects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(projects[0]?.id ?? '')
    }
  }, [activeProjectId, projects])

  if (loading) {
    return <main className="auth-page"><div className="auth-loading">Loading your workspace…</div></main>
  }

  if (!user) {
    return (
      <AuthScreen
        busyMessage={workspaceError}
        onLogin={workspace.login}
        onRegister={workspace.register}
        onAcceptInvitation={workspace.acceptInvitation}
      />
    )
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Stride home">
          <span className="brand-mark"><Command size={17} strokeWidth={2.5} /></span>
          <span>stride<span className="brand-period">.</span></span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-avatar">{currentOrganization?.name.slice(0, 1).toUpperCase() ?? 'W'}</span>
          <span className="workspace-copy"><strong>{currentOrganization?.name ?? 'Workspace'}</strong><small>{organizationRole ? `${organizationRole} · Organization` : 'Organization'}</small></span>
          {organizations.length > 1 && <select aria-label="Switch organization" value={organizationId} onChange={(event) => changeOrganization(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select>}
        </div>

        <div className="sidebar-nav">
          <button className={`sidebar-link${assigneeFilter === currentUser ? ' active' : ''}`} type="button" aria-pressed={assigneeFilter === currentUser} onClick={() => { setAssigneeFilter((current) => current === currentUser ? 'Everyone' : currentUser); setView('board') }}><LayoutGrid size={17} /> My tasks <span className="nav-count">{myTaskCount}</span></button>
          <button className={`sidebar-link${view === 'team' ? ' active' : ''}`} type="button" aria-pressed={view === 'team'} onClick={() => setView('team')}><Users size={17} /> Team</button>
          <button className={`sidebar-link${view === 'calendar' ? ' active' : ''}`} type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={17} /> Calendar</button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-heading">
            <span>YOUR PROJECTS</span>
            <button className="icon-button subtle" type="button" aria-label="Create project" onClick={startProjectCreation}><Plus size={16} /></button>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <button
                className={`project-link${activeProject?.id === project.id ? ' selected' : ''}`}
                key={project.id}
                type="button"
                onClick={() => setActiveProjectId(project.id)}
              >
                <span className="project-dot" style={{ background: project.color }} />
                <span className="project-name">{project.name}</span>
                <span className="project-count">{project.tasks.filter((task) => task.stage !== 'Done').length}</span>
              </button>
            ))}
          </div>
          <button className="add-project" type="button" onClick={startProjectCreation}><Plus size={15} /> New project</button>
        </div>

        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <span className="upgrade-icon"><Sparkles size={15} /></span>
            <strong>Keep your work moving</strong>
            <span>Plan, discuss, and deliver together.</span>
            <button type="button" onClick={startProjectCreation}>Create a project <span>↗</span></button>
          </div>
          <div className="profile-button">
            <span className="avatar avatar-indigo">{currentInitials}</span>
            <span className="profile-copy"><strong>{user.displayName}</strong><small>{user.email}</small></span>
            <button type="button" className="profile-logout" onClick={() => void workspace.logout()}>Sign out</button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Projects</span><span className="crumb-separator">/</span><strong>{activeProject?.name ?? 'New project'}</strong></div>
          <div className="topbar-actions">
            <div className="avatar-stack" aria-label="Project members">
            {members.filter((member) => member.projectIds?.includes(activeProject?.id ?? '')).slice(0, 4).map((member) => <span key={member.id} className={`avatar avatar-${member.color}`} title={member.name}>{member.initials}</span>)}
            <span className="avatar avatar-add"><Plus size={13} /></span>
            </div>
          </div>
        </header>

        <div className="page-content">
          <section className="project-heading">
            <div className="project-heading-main">
              <div className="project-heading-topline">
                <span className="project-heading-dot" style={{ background: activeProject?.color }} />
                <span>{view === 'team' ? 'TEAM' : view === 'calendar' ? 'CALENDAR' : view === 'timeline' ? 'TIMELINE' : activeProject?.key ?? 'PROJECT'}</span>
                <span className="heading-dot-separator">·</span>
                <span className="heading-date">{view === 'team' ? `${teamMembers.length} members` : `${activeProject?.tasks.length ?? 0} issues`}</span>
              </div>
              <h1>{view === 'team' ? 'Team' : activeProject?.name ?? 'Create your first project'}</h1>
              <p>{view === 'team' ? 'See who is working on this project and how work is distributed.' : activeProject?.description || 'A shared space to plan work, track progress, and bring your next great idea to life.'}</p>
            </div>
            <div className="heading-actions">
              {view !== 'team' && <button className="button button-primary" type="button" onClick={() => openNewTask()}><Plus size={17} /><span>Create issue</span></button>}
            </div>
          </section>

          {(view === 'board' || view === 'timeline') && <section className="board-toolbar" aria-label="Project views and issue tools">
            <div className="view-switch">
              <button type="button" className={`view-tab${view === 'board' ? ' active' : ''}`} aria-pressed={view === 'board'} onClick={() => setView('board')}><LayoutGrid size={15} /> Board</button>
              <button type="button" className={`view-tab${view === 'timeline' ? ' active' : ''}`} aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}><CalendarDays size={15} /> Timeline</button>
            </div>
            <div className="toolbar-controls">
              <label className="search-box">
                <Search size={16} />
                <input ref={searchInput} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search tasks..." aria-label="Search tasks" />
                <kbd>/</kbd>
              </label>
              <button className={`button button-secondary filter-toggle${showFilters ? ' pressed' : ''}`} type="button" onClick={() => setShowFilters((shown) => !shown)}>
                <SlidersHorizontal size={16} /><span>Filters</span>
                {[priorityFilter !== 'All priorities', assigneeFilter !== 'Everyone', stageFilter !== 'All stages'].filter(Boolean).length > 0 && <span className="filter-count">!</span>}
              </button>
              {view === 'board' && <button className="icon-button toolbar-more" type="button" aria-label="Sort tasks by priority" title="Sort tasks by priority" onClick={() => updateActiveProject((project) => ({ ...project, tasks: [...project.tasks].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]) }))}><ArrowDownWideNarrow size={17} /></button>}
            </div>
          </section>
          }

          {showFilters && (view === 'board' || view === 'timeline') && (
            <section className="filter-panel" aria-label="Task filters">
              <div className="filter-panel-title"><Filter size={15} /><strong>Filter tasks</strong><span>Refine what appears on your board</span></div>
              <label>Priority
                <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                  <option>All priorities</option>{priorities.map((priority) => <option key={priority}>{priority}</option>)}
                </select>
              </label>
              <label>Assignee
                <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
                  <option>Everyone</option>{members.map((member) => <option key={member.id} value={member.name}>{member.name}</option>)}
                </select>
              </label>
              <label>Status
                <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
                  <option>All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}
                </select>
              </label>
              <button className="clear-filters" type="button" onClick={() => { setPriorityFilter('All priorities'); setAssigneeFilter('Everyone'); setStageFilter('All stages') }}>Clear all</button>
            </section>
          )}

          {view === 'timeline' && activeProject && (
            <section className="timeline-view" aria-label={`${activeProject.name} issue timeline`}>
              <div className="calendar-toolbar">
                <div className="calendar-month-nav">
                  <button className="icon-button" type="button" aria-label="Previous month" onClick={() => setTimelineMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
                  <h2>{monthLabel(timelineMonth)}</h2>
                  <button className="icon-button" type="button" aria-label="Next month" onClick={() => setTimelineMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
                  <button className="button button-secondary calendar-today" type="button" onClick={() => setTimelineMonth(monthStart(new Date()))}>Today</button>
                </div>
                <span className="calendar-hint">Bars show each issue’s scheduled start and due dates</span>
              </div>
              <div className="timeline-scroll">
                <div className="timeline-grid" style={{ gridTemplateColumns: `minmax(210px, 240px) repeat(${timelineDays.length}, minmax(32px, 1fr))` }}>
                  <div className="timeline-issue-heading">Issue</div>
                  {timelineDays.map((day) => <div className={`timeline-day-heading${dateKey(day) === dateKey(new Date()) ? ' today' : ''}`} key={dateKey(day)}><span>{day.toLocaleDateString('en-US', { weekday: 'narrow' })}</span><strong>{day.getDate()}</strong></div>)}
                  {visibleTasks.map((task) => {
                    const startDate = task.startDate
                    const dueDate = task.dueDate
                    const isScheduled = Boolean(startDate && dueDate)
                    const issueType = task.issueType ?? 'Task'
                    let barStart = 0
                    let barSpan = 0
                    if (isScheduled && startDate && dueDate) {
                      const viewStart = dateKey(timelineDays[0])
                      const viewEnd = dateKey(timelineDays[timelineDays.length - 1])
                      const overlaps = startDate <= viewEnd && dueDate >= viewStart
                      if (overlaps) {
                        barStart = Math.max(0, calendarDayDifference(timelineDays[0], toLocalDate(startDate)))
                        const barEnd = Math.min(timelineDays.length - 1, calendarDayDifference(timelineDays[0], toLocalDate(dueDate)))
                        barSpan = barEnd - barStart + 1
                      }
                    }
                    if (isScheduled && barSpan === 0) return null
                    const member = memberFor(task.assignee, members)
                    return (
                      <div className="timeline-issue-row" key={task.id} style={{ gridTemplateColumns: `minmax(210px, 240px) repeat(${timelineDays.length}, minmax(32px, 1fr))` }}>
                        <button className="timeline-issue-summary" type="button" onClick={() => openTask(task)}>
                          <span className={`issue-type-icon issue-${issueType.toLowerCase()}`}>{issueIcon(issueType)}</span>
                          <span><strong>{task.key ?? task.id}</strong><span>{task.title}</span></span>
                        </button>
                        <div className="timeline-track" style={{ backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc(${100 / timelineDays.length}% - 1px), #ebecf0 calc(${100 / timelineDays.length}% - 1px), #ebecf0 ${100 / timelineDays.length}%)` }}>
                          {barSpan > 0 && <button className={`timeline-bar priority-bar-${task.priority.toLowerCase()}`} type="button" style={{ left: `${barStart / timelineDays.length * 100}%`, width: `${barSpan / timelineDays.length * 100}%` }} title={`${task.title}: ${dateLabel(startDate!)} – ${dateLabel(dueDate!)}`} onClick={() => openTask(task)}><span>{task.title}</span></button>}
                        </div>
                        <span className="timeline-assignee"><span className={`avatar avatar-${member.color}`}>{member.initials}</span></span>
                      </div>
                    )
                  })}
                  {visibleTasks.length === 0 && <div className="timeline-empty">No issues match your search or filters.</div>}
                </div>
              </div>
              {visibleTasks.some((task) => !task.startDate || !task.dueDate) && (
                <div className="unscheduled-section">
                  <h3>Unscheduled <span>{visibleTasks.filter((task) => !task.startDate || !task.dueDate).length}</span></h3>
                  <div className="unscheduled-list">
                    {visibleTasks.filter((task) => !task.startDate || !task.dueDate).map((task) => (
                      <button className="unscheduled-issue" type="button" key={task.id} onClick={() => openTask(task)}>
                        <span className={`issue-type-icon issue-${(task.issueType ?? 'Task').toLowerCase()}`}>{issueIcon(task.issueType ?? 'Task')}</span>
                        <strong>{task.key ?? task.id}</strong><span>{task.title}</span><span>{task.startDate ? `Due ${dateLabel(task.dueDate)}` : 'Add a start date'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {view === 'calendar' && activeProject && (
            <section className="calendar-view" aria-label={`${activeProject.name} due date calendar`}>
              <div className="calendar-toolbar">
                <div className="calendar-month-nav">
                  <button className="icon-button" type="button" aria-label="Previous month" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
                  <h2>{monthLabel(calendarMonth)}</h2>
                  <button className="icon-button" type="button" aria-label="Next month" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
                  <button className="button button-secondary calendar-today" type="button" onClick={() => setCalendarMonth(monthStart(new Date()))}>Today</button>
                </div>
                <span className="calendar-hint">{visibleTasks.filter((task) => task.dueDate).length} issues with due dates</span>
              </div>
              <div className="calendar-grid">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
                {calendarDays.map((day) => {
                  const key = dateKey(day)
                  const dueTasks = visibleTasks.filter((task) => task.dueDate === key)
                  const inMonth = day.getMonth() === calendarMonth.getMonth()
                  return (
                    <div className={`calendar-day${inMonth ? '' : ' outside-month'}${key === dateKey(new Date()) ? ' today' : ''}`} key={key}>
                      <div className="calendar-day-heading"><span>{day.getDate()}</span><button type="button" aria-label={`Create issue due ${key}`} onClick={() => openNewTask('To do', key)}><Plus size={14} /></button></div>
                      <div className="calendar-day-issues">
                        {dueTasks.slice(0, 3).map((task) => <button className={`calendar-issue priority-calendar-${task.priority.toLowerCase()}`} type="button" key={task.id} onClick={() => openTask(task)} title={`${task.key}: ${task.title}`}><span>{task.key}</span><span>{task.title}</span></button>)}
                        {dueTasks.length > 3 && <span className="calendar-more">+{dueTasks.length - 3} more</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              {visibleTasks.every((task) => !task.dueDate) && <p className="calendar-empty">No issues with due dates yet. Use the + on a day to create a scheduled issue.</p>}
            </section>
          )}

          {view === 'team' && activeProject && (
            <section className="team-view" aria-label={`${activeProject.name} team workload`}>
              <div className="team-intro"><Users size={18} /><div><strong>Project team</strong><span>Workload for {activeProject.name}. Select a member to view their open issues.</span></div></div>
              {canManageOrganization && (
                <div className="team-admin-panel">
                  <form className="team-invite-form" onSubmit={sendInvitation}>
                    <div className="team-admin-heading"><div><h3>Invite someone</h3><p>Send an email invitation and choose their initial project access.</p></div></div>
                    <label className="form-field"><span className="field-label"><Mail size={14} /> Email address</span><input className="text-input" type="email" required maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@company.com" /></label>
                    <label className="form-field"><span className="field-label"><CircleUserRound size={14} /> Organization role</span><select className="text-input" value={canManageOrganization && organizationRole === 'owner' ? inviteRole : 'member'} disabled={organizationRole !== 'owner'} onChange={(event) => setInviteRole(event.target.value as 'admin' | 'member')}><option value="member">Member</option>{organizationRole === 'owner' && <option value="admin">Admin</option>}</select></label>
                    <fieldset className="team-project-choices"><legend>Project access</legend>{projects.map((project) => <label key={project.id}><input type="checkbox" checked={inviteProjectIds.includes(project.id)} onChange={(event) => setInviteProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} /><span>{project.name}</span></label>)}</fieldset>
                    <button className="button button-primary" type="submit"><Plus size={15} /> Send invitation</button>
                  </form>
                  {invitations.length > 0 && <div className="team-pending-invitations"><h3>Pending invitations</h3>{invitations.map((invitation) => <div className="team-invitation-row" key={invitation.id}><span><strong>{invitation.email}</strong><small>{invitation.role} · expires {new Date(invitation.expires_at).toLocaleDateString()}</small></span><button className="button button-secondary" type="button" onClick={() => void workspace.cancelInvitation(invitation.id)}>Cancel</button></div>)}</div>}
                </div>
              )}
              <div className="team-grid">
                {teamMembers.map((member) => {
                  const assignedTasks = activeProject.tasks.filter((task) => task.assignee === member.name)
                  const openTasks = assignedTasks.filter((task) => task.stage !== 'Done')
                  const completedTasks = assignedTasks.length - openTasks.length
                  const overdueTasks = openTasks.filter((task) => isOverdue(task.dueDate, task.stage)).length
                  const allocation = allocationDrafts[member.id ?? ''] ?? {
                    role: member.role === 'admin' ? 'admin' as const : 'member' as const,
                    projectIds: member.projectIds ?? [],
                  }
                  return (
                    <article className="team-card" key={member.id ?? member.name}>
                      <div className="team-member-heading"><span className={`avatar avatar-${member.color} team-avatar`}>{member.initials}</span><div><h3>{member.name}</h3><span>{member.email}</span></div><span className="team-role"><CircleUserRound size={13} /> {member.role}</span></div>
                      <div className="team-stats"><div><strong>{openTasks.length}</strong><span>Open issues</span></div><div><strong>{completedTasks}</strong><span>Completed</span></div><div className={overdueTasks ? 'team-overdue' : ''}><strong>{overdueTasks}</strong><span>Overdue</span></div></div>
                      <div className="team-card-footer"><span>{assignedTasks.length ? `${assignedTasks.length} assigned in this project` : 'No issues assigned yet'}</span><button type="button" disabled={!openTasks.length} onClick={() => { setAssigneeFilter(member.name); setView('board') }}>View issues <ChevronRight size={14} /></button></div>
                      {canManageOrganization && member.role !== 'owner' && member.id && (
                        <div className="team-allocation">
                          <label>Organization role<select className="text-input" value={allocation.role} disabled={organizationRole !== 'owner'} onChange={(event) => setAllocationDrafts((current) => ({ ...current, [member.id!]: { ...allocation, role: event.target.value as 'admin' | 'member' } }))}><option value="member">Member</option><option value="admin">Admin</option></select></label>
                          <fieldset className="team-project-choices"><legend>Project access</legend>{projects.map((project) => <label key={project.id}><input type="checkbox" checked={allocation.projectIds.includes(project.id)} onChange={(event) => setAllocationDrafts((current) => ({ ...current, [member.id!]: { ...allocation, projectIds: event.target.checked ? [...new Set([...allocation.projectIds, project.id])] : allocation.projectIds.filter((id) => id !== project.id) } }))} /><span>{project.name}</span></label>)}</fieldset>
                          <div className="team-allocation-actions"><button className="button button-secondary" type="button" onClick={() => void saveMemberAllocation(member.id!)}>Save access</button><button className="button button-secondary" type="button" onClick={() => { if (window.confirm(`Remove ${member.name} from this organization? Their unassigned project access and sessions will be revoked.`)) void workspace.removeMember(member.id!) }}>Remove member</button></div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
              {teamMembers.length === 0 && <p className="calendar-empty">No members have access to this project yet.</p>}
            </section>
          )}

          {view === 'board' && <section className="kanban-board" aria-label={`${activeProject?.name ?? 'Project'} Kanban board`}>
            {stages.map((stage, index) => {
              const tasks = visibleTasks.filter((task) => task.stage === stage)
              return (
                <section
                  className={`board-column stage-${index}${draggedTaskId ? ' drop-ready' : ''}`}
                  key={stage}
                  aria-label={`${stage}, ${tasks.length} tasks`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); if (draggedTaskId) moveTask(draggedTaskId, stage) }}
                >
                  <div className="column-heading">
                    <div className="column-title-group">
                      <span className={`stage-indicator stage-indicator-${index}`} />
                      <h2>{stage}</h2>
                      <span className="task-count">{tasks.length}</span>
                    </div>
                    <button type="button" className="icon-button subtle column-menu" aria-label={`Add task to ${stage}`} onClick={() => openNewTask(stage)}><Plus size={17} /></button>
                  </div>
                  <div className="task-stack">
                    {tasks.map((task) => {
                      const member = memberFor(task.assignee, members)
                      const overdue = isOverdue(task.dueDate, task.stage)
                      const type = task.issueType ?? 'Task'
                      return (
                        <button
                          type="button"
                          className={`task-card${draggedTaskId === task.id ? ' dragging' : ''}`}
                          key={task.id}
                          draggable
                          onDragStart={() => setDraggedTaskId(task.id)}
                          onDragEnd={() => setDraggedTaskId('')}
                          onClick={() => openTask(task)}
                          aria-label={`${task.title}, ${task.priority} priority, assigned to ${task.assignee}, ${stage}`}
                        >
                          <span className="task-card-top">
                            <span className="issue-key"><span className={`issue-type-icon issue-${type.toLowerCase()}`}>{issueIcon(type)}</span>{task.key ?? `${activeProject?.key ?? 'PROJ'}-?`}</span>
                            <span className={`priority-tag priority-${task.priority.toLowerCase()}`}><span />{task.priority}</span>
                          </span>
                          <span className="task-title">{task.title}</span>
                          {task.description && <span className="task-description">{task.description}</span>}
                          {task.labels.length > 0 && <span className="task-labels">{task.labels.slice(0, 3).map((label) => <span className={`label-chip label-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`} key={label}>{label}</span>)}</span>}
                          <span className="task-card-footer">
                            <span className={`due-date${overdue ? ' overdue' : ''}`}><Clock3 size={13} />{dateLabel(task.dueDate)}</span>
                            <span className="task-card-meta">
                              {task.comments.length > 0 && <span className="comment-count"><MessageCircle size={13} />{task.comments.length}</span>}
                              <span className={`avatar avatar-${member.color} card-avatar`} title={member.name}>{member.initials}</span>
                            </span>
                          </span>
                        </button>
                      )
                    })}
                    {tasks.length === 0 && <div className="column-empty">{visibleTasks.length ? 'Nothing here yet' : 'No tasks match your filters'}</div>}
                  </div>
                  <button className="column-add-task" type="button" onClick={() => openNewTask(stage)}><Plus size={15} /> Create issue</button>
                </section>
              )
            })}
          </section>}
          {view === 'board' && visibleTasks.length === 0 && !searchText && priorityFilter === 'All priorities' && assigneeFilter === 'Everyone' && stageFilter === 'All stages' && (
            <div className="empty-project-note"><Target size={16} /> Your board is ready. Add a task to get things moving.</div>
          )}
        </div>
        <footer className="board-footer"><span><span className="online-dot" /> {workspaceError ? 'Action needs attention' : 'Connected to workspace'}</span><span>{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'} in this view</span><span className="footer-shortcut">Press / to search</span></footer>
      </main>

      {workspaceError && <div className="storage-alert" role="alert"><span>{workspaceError}</span><button type="button" aria-label="Dismiss error" onClick={() => setWorkspaceError('')}><X size={15} /></button></div>}

      {projectDialogOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectDialogOpen(false) }}>
          <section className="dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
            <div className="dialog-heading">
              <div><span className="dialog-kicker">PROJECT SETUP</span><h2 id="project-dialog-title">Create a project</h2><p>Set up a project space with its own issue key.</p></div>
              <button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setProjectDialogOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={createProject}>
              <label className="field-label" htmlFor="project-name">Project name <span>*</span></label>
              <input id="project-name" className="text-input" autoFocus required maxLength={56} placeholder="e.g. Website redesign" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              <label className="field-label" htmlFor="project-key">Project key <span>*</span><span className="optional-label">Used in issue IDs, e.g. WEB-1</span></label>
              <input id="project-key" className={`text-input${projectKeyError ? ' input-error' : ''}`} required minLength={2} maxLength={10} pattern="[A-Za-z][A-Za-z0-9]{1,9}" placeholder="e.g. WEB" value={projectKey} onChange={(event) => { setProjectKey(event.target.value.toUpperCase()); setProjectKeyError('') }} />
              {projectKeyError && <span className="field-error" role="alert">{projectKeyError}</span>}
              <label className="field-label" htmlFor="project-description">Description <span className="optional-label">Optional</span></label>
              <textarea id="project-description" className="text-input textarea-input" maxLength={180} placeholder="What are you working towards?" value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} />
              <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setProjectDialogOpen(false)}>Cancel</button><button type="submit" className="button button-primary"><Plus size={16} /> Create project</button></div>
            </form>
          </section>
        </div>
      )}

      {taskDraft && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTaskDraft(null) }}>
          <section className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title">
            <div className="dialog-heading task-dialog-heading">
              <div><span className="dialog-kicker">{taskIsNew ? 'CREATE ISSUE' : taskDraft.key ?? 'ISSUE DETAILS'}</span><h2 id="task-dialog-title">{taskIsNew ? 'Create an issue' : taskDraft.title || 'Issue details'}</h2></div>
              <button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setTaskDraft(null)}><X size={18} /></button>
            </div>
            <form onSubmit={saveTask}>
              <div className="issue-detail-keyline"><span className={`issue-type-icon issue-${(taskDraft.issueType ?? 'Task').toLowerCase()}`}>{issueIcon(taskDraft.issueType ?? 'Task')}</span><span>{taskDraft.key ?? (activeProject ? nextIssueKey(activeProject) : 'PROJ-1')}</span><span>·</span><span>{activeProject?.name}</span></div>
              <label className="field-label" htmlFor="task-type">Issue type</label>
              <select id="task-type" className="text-input issue-type-select" value={taskDraft.issueType ?? 'Task'} onChange={(event) => setTaskDraft({ ...taskDraft, issueType: event.target.value as IssueType })}>{issueTypes.map((type) => <option key={type}>{type}</option>)}</select>
              <label className="field-label" htmlFor="task-title">Summary <span>*</span></label>
              <input id="task-title" className="text-input task-title-input" autoFocus required maxLength={120} placeholder="What needs to get done?" value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} />
              <label className="field-label" htmlFor="task-description">Description</label>
              <textarea id="task-description" className="text-input textarea-input" maxLength={800} placeholder="Add a little more context..." value={taskDraft.description} onChange={(event) => setTaskDraft({ ...taskDraft, description: event.target.value })} />
              <div className="task-fields-grid">
                <label className="form-field"><span className="field-label"><LayoutGrid size={14} /> Status</span>
                  <select className="text-input" value={taskDraft.stage} onChange={(event) => setTaskDraft({ ...taskDraft, stage: event.target.value as Stage })}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select>
                </label>
                <label className="form-field"><span className="field-label"><SlidersHorizontal size={14} /> Priority</span>
                  <select className="text-input" value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value as Priority })}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select>
                </label>
                <label className="form-field"><span className="field-label"><Users size={14} /> Assignee</span>
                  <select className="text-input" value={taskDraft.assignee} onChange={(event) => setTaskDraft({ ...taskDraft, assignee: event.target.value, assigneeId: projectMembers.find((member) => member.name === event.target.value)?.id ?? null })}><option value="Unassigned">Unassigned</option>{projectMembers.map((member) => <option key={member.id} value={member.name}>{member.name}</option>)}</select>
                </label>
                <label className="form-field"><span className="field-label"><CalendarDays size={14} /> Due date</span>
                  <input className="text-input" type="date" min={taskDraft.startDate || undefined} value={taskDraft.dueDate} onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })} />
                </label>
                <label className="form-field"><span className="field-label"><CalendarDays size={14} /> Start date</span>
                  <input className="text-input" type="date" max={taskDraft.dueDate || undefined} value={taskDraft.startDate ?? ''} onChange={(event) => setTaskDraft({ ...taskDraft, startDate: event.target.value })} />
                </label>
              </div>
              <label className="field-label" htmlFor="task-labels">Labels <span className="optional-label">Separate with commas</span></label>
              <input id="task-labels" className="text-input" placeholder="Design, Research, Engineering" value={taskDraft.labels.join(', ')} onChange={(event) => setTaskDraft({ ...taskDraft, labels: [...new Set(event.target.value.split(',').map((label) => label.trim()).filter(Boolean))].slice(0, 6) })} />

              {!taskIsNew && (
                <div className="comments-section">
                  <div className="comments-heading"><strong><MessageCircle size={15} /> Activity & comments</strong><span>{taskDraft.comments.length}</span></div>
                  <div className="comments-list">
                    {taskDraft.comments.map((comment) => {
                      const author = memberFor(comment.author, members)
                      return <div className="comment" key={comment.id}><span className={`avatar avatar-${author.color}`}>{author.initials}</span><div className="comment-content"><div className="comment-author"><strong>{comment.author}</strong><span>{new Date(comment.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{comment.author === currentUser && <span className="comment-actions"><button type="button" aria-label="Edit comment" onClick={() => editComment(comment.id)}><Pencil size={12} /></button><button type="button" aria-label="Delete comment" onClick={() => deleteComment(comment.id)}><Trash2 size={12} /></button></span>}</div>{editingCommentId === comment.id ? <><textarea className="comment-edit-input" aria-label="Edit comment" value={editCommentText} onChange={(event) => setEditCommentText(event.target.value)} /><div className="comment-edit-actions"><button type="button" onClick={() => { setEditingCommentId(''); setEditCommentText('') }}>Cancel</button><button type="button" disabled={!editCommentText.trim()} onClick={() => saveEditedComment(comment.id)}>Save</button></div></> : <p>{comment.body}</p>}</div></div>
                    })}
                    {taskDraft.comments.length === 0 && <div className="no-comments"><MessageCircle size={17} /><span>No comments yet. Add context or ask a question.</span></div>}
                  </div>
                  <div className="comment-composer"><span className="avatar avatar-indigo">{currentInitials}</span><textarea aria-label="Write a comment" placeholder="Add a comment..." value={newComment} onChange={(event) => setNewComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); addComment() } }} /><button type="button" onClick={addComment} disabled={!newComment.trim()}>Comment</button></div>
                </div>
              )}
              <div className="dialog-actions task-dialog-actions">
                {!taskIsNew && <button type="button" className="delete-task" onClick={deleteTask}>Delete task</button>}
                <button type="button" className="button button-secondary" onClick={() => setTaskDraft(null)}>Cancel</button>
                <button type="submit" className="button button-primary"><Check size={16} /> {taskIsNew ? 'Create task' : 'Save changes'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
