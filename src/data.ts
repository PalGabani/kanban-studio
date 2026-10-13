import type { Project, Task } from './types'

const today = new Date()
const dateOffset = (days: number) => {
  const date = new Date(today)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const task = (
  id: string,
  title: string,
  stage: Task['stage'],
  priority: Task['priority'],
  assignee: string,
  days: number,
  labels: string[],
  description = '',
): Task => ({
  id,
  title,
  stage,
  priority,
  assignee,
  startDate: dateOffset(days - 3),
  dueDate: dateOffset(days),
  labels,
  description,
  comments: [],
})

export const starterProjects: Project[] = [
  {
    id: 'project-studio',
    key: 'WEB',
    issueCounter: 15,
    name: 'Website redesign',
    description: 'A fresh, thoughtful home for our digital studio.',
    color: '#0c66e4',
    tasks: [
      task('task-01', 'Map the current customer journey', 'Backlog', 'Low', 'Jamie Chen', 8, ['Research']),
      task('task-02', 'Collect inspiration for the new visual direction', 'Backlog', 'Medium', 'Alex Morgan', 12, ['Design']),
      task('task-03', 'Audit existing page performance', 'Backlog', 'Medium', 'Sam Rivera', 10, ['Engineering']),
      task('task-04', 'Define the new navigation structure', 'To do', 'High', 'Taylor Kim', 4, ['Research', 'Planning']),
      task('task-05', 'Write homepage story and key messaging', 'To do', 'Medium', 'Jamie Chen', 6, ['Content']),
      task('task-06', 'Review accessibility requirements', 'To do', 'Low', 'Sam Rivera', 7, ['Research']),
      task('task-07', 'Create responsive design system', 'In progress', 'High', 'Alex Morgan', 2, ['Design', 'UI']),
      task('task-08', 'Design homepage hero and featured work', 'In progress', 'Urgent', 'Jamie Chen', 1, ['Design', 'UI']),
      task('task-09', 'Build shared header and footer', 'In progress', 'Medium', 'Sam Rivera', 5, ['Engineering']),
      task('task-10', 'Prototype project detail page', 'Review', 'High', 'Taylor Kim', 0, ['Design', 'UI']),
      task('task-11', 'Set up typography and color tokens', 'Review', 'Low', 'Alex Morgan', -1, ['Design']),
      task('task-12', 'Configure project repository', 'Done', 'Medium', 'Sam Rivera', -4, ['Engineering']),
      task('task-13', 'Kick-off and align on success metrics', 'Done', 'High', 'Taylor Kim', -6, ['Planning']),
      task('task-14', 'Create project brief', 'Done', 'Low', 'Jamie Chen', -7, ['Content']),
    ],
  },
]

starterProjects[0].tasks.forEach((task, index) => {
  task.key = `WEB-${index + 1}`
  task.issueType = index === 2 ? 'Bug' : index === 1 || index === 7 ? 'Story' : 'Task'
})
