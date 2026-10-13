import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { starterProjects } from './data'
import { stages, type IssueType, type Project } from './types'

const storageKey = 'stride-kanban-projects-v1'

function readProjects(): { projects: Project[]; error: string } {
  try {
    const value = window.localStorage.getItem(storageKey)
    if (!value) return { projects: starterProjects, error: '' }
    const parsed: unknown = JSON.parse(value)
    if (
      !Array.isArray(parsed) ||
      !parsed.every((project) => isProject(project))
    ) {
      throw new Error('Saved projects have an invalid shape.')
    }
    const projects = (parsed as Project[]).map((project, projectIndex) => {
      const key = project.key || makeProjectKey(project.name, projectIndex)
      let highestIssueNumber = 0
      const tasks = project.tasks.map((task, taskIndex) => {
        const taskKey = task.key || `${key}-${taskIndex + 1}`
        const issueNumber = Number(taskKey.match(/-(\d+)$/)?.[1] ?? 0)
        highestIssueNumber = Math.max(highestIssueNumber, issueNumber)
        return {
          ...task,
          key: taskKey,
          issueType: task.issueType || 'Task',
        }
      })
      return {
        ...project,
        color: project.color.toLowerCase() === '#7768e5' ? '#0c66e4' : project.color,
        key,
        issueCounter: Math.max(project.issueCounter ?? 1, highestIssueNumber + 1),
        tasks,
      }
    })
    return { projects, error: '' }
  } catch (error) {
    console.error('Unable to load Stride project data from browser storage.', error)
    return {
      projects: starterProjects,
      error: 'Saved project data could not be loaded. Your new changes may replace the invalid saved data.',
    }
  }
}

function makeProjectKey(name: string, index: number) {
  const key = name.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase()
  return key.length >= 2 ? key : `PR${index + 1}`
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const project = value as Record<string, unknown>
  return typeof project.id === 'string' &&
    (project.key === undefined || typeof project.key === 'string') &&
    (project.issueCounter === undefined || (typeof project.issueCounter === 'number' && Number.isInteger(project.issueCounter) && project.issueCounter > 0)) &&
    typeof project.name === 'string' &&
    typeof project.description === 'string' &&
    typeof project.color === 'string' &&
    Array.isArray(project.tasks) &&
    project.tasks.every((value) => {
      if (!value || typeof value !== 'object') return false
      const task = value as Record<string, unknown>
      return typeof task.id === 'string' &&
        (task.key === undefined || typeof task.key === 'string') &&
        (task.issueType === undefined || ['Task', 'Story', 'Bug'].includes(task.issueType as IssueType)) &&
        typeof task.title === 'string' &&
        typeof task.description === 'string' &&
        stages.includes(task.stage as (typeof stages)[number]) &&
        ['Urgent', 'High', 'Medium', 'Low'].includes(task.priority as string) &&
        typeof task.assignee === 'string' &&
        (task.startDate === undefined || task.startDate === '' || isCalendarDate(task.startDate)) &&
        typeof task.dueDate === 'string' &&
        Array.isArray(task.labels) &&
        task.labels.every((label) => typeof label === 'string') &&
        Array.isArray(task.comments) &&
        task.comments.every((comment) => comment && typeof comment.id === 'string' && typeof comment.author === 'string' && typeof comment.body === 'string' && typeof comment.createdAt === 'string')
    })
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function useProjects() {
  const [initial] = useState(readProjects)
  const [projects, setProjects] = useState(initial.projects)
  const [storageError, setStorageError] = useState(initial.error)
  const [dirty, setDirty] = useState(false)

  const updateProjects: Dispatch<SetStateAction<Project[]>> = (nextProjects) => {
    setProjects(nextProjects)
    setDirty(true)
  }

  useEffect(() => {
    if (!dirty) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(projects))
      setStorageError('')
    } catch (error) {
      console.error('Unable to save Stride project data to browser storage.', error)
      setStorageError('Changes could not be saved in this browser. Check storage permissions or available space.')
    }
  }, [dirty, projects])

  return { projects, setProjects: updateProjects, storageError }
}
