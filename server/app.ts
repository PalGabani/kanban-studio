import { randomUUID } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from './config.js'
import { pool } from './db.js'
import { sendOrganizationInvite } from './mailer.js'
import type { AuthContext, OrganizationRole } from './roles.js'
import { createSecret, hashPassword, hashToken, normalizeEmail, verifyPassword } from './security.js'

const app = express()
const emailSchema = z.string().trim().email().max(254).transform(normalizeEmail)
const passwordSchema = z.string().min(12).max(128)
const uuidSchema = z.string().uuid()

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb', strict: true }))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next()
    return
  }
  if (req.get('origin') !== config.APP_ORIGIN) {
    res.status(403).json({ error: 'Request origin is not allowed.' })
    return
  }
  next()
})

app.use('/api', (req, _res, next) => {
  const token = readCookie(req, config.SESSION_COOKIE_NAME)
  if (!token) {
    next()
    return
  }
  pool.query<AuthContext & { expires_at: Date }>(
    `SELECT s.id AS "sessionId", u.id AS "userId", u.email, u.display_name AS "displayName", s.expires_at
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  ).then(({ rows }) => {
    if (rows[0]) {
      const { expires_at: _expiresAt, ...auth } = rows[0]
      req.auth = auth
    }
    next()
  }).catch(next)
})

function readCookie(req: Request, name: string) {
  const prefix = `${name}=`
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : ''
}

function setSessionCookie(res: Response, token: string, maxAge: number) {
  res.cookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
}

function clearSessionCookie(res: Response) {
  res.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

function requireAuth(req: Request, res: Response): AuthContext | null {
  if (req.auth) return req.auth
  res.status(401).json({ error: 'Sign in to continue.' })
  return null
}

function parseOrganizationId(req: Request, res: Response) {
  const parsed = uuidSchema.safeParse(req.params.organizationId)
  if (parsed.success) return parsed.data
  res.status(400).json({ error: 'Organization ID is invalid.' })
  return null
}

async function getOrganizationRole(organizationId: string, userId: string) {
  const result = await pool.query<{ role: OrganizationRole }>(
    'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  )
  return result.rows[0]?.role ?? null
}

function requireAdmin(role: OrganizationRole | null, res: Response) {
  if (role === 'owner' || role === 'admin') return true
  res.status(403).json({ error: 'Organization administrator access is required.' })
  return false
}

function makeSlug(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${slug || 'workspace'}-${randomUUID().slice(0, 6)}`
}

async function createSession(userId: string) {
  const token = createSecret()
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000)
  const result = await pool.query(
    'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
    [userId, hashToken(token), expiresAt],
  )
  return { token, sessionId: result.rows[0].id as string, maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000 }
}

const registrationSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
  organizationName: z.string().trim().min(1).max(100),
})

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok' })
})

app.get('/api/auth/session', (req, res) => {
  if (!req.auth) {
    res.json({ user: null, organizations: [] })
    return
  }
  pool.query(
    `SELECT o.id, o.name, o.slug, m.role
     FROM organization_memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1
     ORDER BY o.name`,
    [req.auth.userId],
  ).then(({ rows }) => {
    res.json({
      user: { id: req.auth!.userId, email: req.auth!.email, displayName: req.auth!.displayName },
      organizations: rows,
    })
  }).catch((error: unknown) => {
    res.status(500).json({ error: 'Unable to load account organizations.' })
    console.error('Unable to load account organizations.', error)
  })
})

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) })
    return
  }
  const { email, password, displayName, organizationName } = parsed.data
  const passwordHash = await hashPassword(password)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const user = await client.query<{ id: string }>(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [email, displayName, passwordHash],
    )
    const organization = await client.query<{ id: string; name: string; slug: string }>(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug',
      [organizationName, makeSlug(organizationName)],
    )
    await client.query(
      "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [organization.rows[0].id, user.rows[0].id],
    )
    const token = createSecret()
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000)
    await client.query(
      'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.rows[0].id, hashToken(token), expiresAt],
    )
    await client.query('COMMIT')
    setSessionCookie(res, token, config.SESSION_TTL_HOURS * 60 * 60 * 1000)
    res.status(201).json({
      user: { id: user.rows[0].id, email, displayName },
      organization: { ...organization.rows[0], role: 'owner' },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'An account with this email already exists.' })
      return
    }
    throw error
  } finally {
    client.release()
  }
})

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid email and password.' })
    return
  }
  const { rows } = await pool.query<{ id: string; email: string; display_name: string; password_hash: string }>(
    'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
    [parsed.data.email],
  )
  const user = rows[0]
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    res.status(401).json({ error: 'Email or password is incorrect.' })
    return
  }
  const session = await createSession(user.id)
  setSessionCookie(res, session.token, session.maxAge)
  res.json({ user: { id: user.id, email: user.email, displayName: user.display_name } })
})

app.post('/api/auth/logout', async (req, res) => {
  if (req.auth) {
    await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [req.auth.sessionId])
  }
  clearSessionCookie(res)
  res.status(204).end()
})

const inviteAcceptSchema = z.object({
  token: z.string().min(30).max(100),
  displayName: z.string().trim().min(1).max(100),
  password: passwordSchema.optional(),
})

app.get('/api/invitations/inspect', async (req, res) => {
  const token = z.string().min(30).max(100).safeParse(req.query.token)
  if (!token.success) {
    res.status(400).json({ error: 'Invitation token is invalid.' })
    return
  }
  const result = await pool.query(
    `SELECT i.email, i.role, i.expires_at, o.name AS organization_name
     FROM invitations i
     JOIN organizations o ON o.id = i.organization_id
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [hashToken(token.data)],
  )
  if (!result.rows[0]) {
    res.status(404).json({ error: 'This invitation is invalid, expired, or already used.' })
    return
  }
  res.json({
    email: result.rows[0].email,
    role: result.rows[0].role,
    organizationName: result.rows[0].organization_name,
    expiresAt: result.rows[0].expires_at,
  })
})

app.post('/api/invitations/accept', authLimiter, async (req, res) => {
  const parsed = inviteAcceptSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) })
    return
  }
  const { token, displayName, password } = parsed.data
  const client = await pool.connect()
  let sessionToken: string | null = null
  try {
    await client.query('BEGIN')
    const invitation = await client.query<{
      id: string
      organization_id: string
      email: string
      role: Exclude<OrganizationRole, 'owner'>
      project_ids: string[]
    }>(
      `SELECT id, organization_id, email, role, project_ids
       FROM invitations
       WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hashToken(token)],
    )
    const invite = invitation.rows[0]
    if (!invite) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'This invitation is invalid, expired, or already used.' })
      return
    }
    const existing = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1 FOR UPDATE', [invite.email])
    let userId = existing.rows[0]?.id
    if (userId && req.auth?.userId !== userId) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Sign in to the invited account before accepting this invitation.' })
      return
    }
    if (!userId) {
      if (!password) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Choose a password to create your account.' })
        return
      }
      const passwordHash = await hashPassword(password)
      const created = await client.query<{ id: string }>(
        'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [invite.email, displayName, passwordHash],
      )
      userId = created.rows[0].id
    }
    await client.query(
      'INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)',
      [invite.organization_id, userId, invite.role],
    )
    if (invite.project_ids.length) {
      await client.query(
        `INSERT INTO project_memberships (organization_id, project_id, user_id)
         SELECT $1, allocated.project_id, $2 FROM unnest($3::uuid[]) AS allocated(project_id)
         ON CONFLICT DO NOTHING`,
        [invite.organization_id, userId, invite.project_ids],
      )
    }
    await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invite.id])
    if (!req.auth) {
      sessionToken = createSecret()
      await client.query(
        'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [userId, hashToken(sessionToken), new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000)],
      )
    }
    await client.query('COMMIT')
    if (sessionToken) setSessionCookie(res, sessionToken, config.SESSION_TTL_HOURS * 60 * 60 * 1000)
    res.json({ organizationId: invite.organization_id })
  } catch (error) {
    await client.query('ROLLBACK')
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'The invitation could not be accepted because the account or membership already exists.' })
      return
    }
    throw error
  } finally {
    client.release()
  }
})

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'member']),
  projectIds: z.array(uuidSchema).max(100).default([]),
})

app.post('/api/organizations/:organizationId/invitations', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const parsed = inviteSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) })
    return
  }
  const role = await getOrganizationRole(organizationId, auth.userId)
  if (!requireAdmin(role, res)) return
  if (role !== 'owner' && parsed.data.role === 'admin') {
    res.status(403).json({ error: 'Only the organization owner can invite administrators.' })
    return
  }
  const existing = await pool.query(
    'SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2',
    [organizationId, parsed.data.email],
  )
  if (existing.rowCount) {
    res.status(409).json({ error: 'This email already belongs to the organization.' })
    return
  }
  if (parsed.data.projectIds.length) {
    const allocated = await pool.query(
      'SELECT id FROM projects WHERE organization_id = $1 AND id = ANY($2::uuid[])',
      [organizationId, parsed.data.projectIds],
    )
    if (allocated.rowCount !== new Set(parsed.data.projectIds).size) {
      res.status(400).json({ error: 'One or more selected projects do not belong to this organization.' })
      return
    }
  }
  const token = createSecret()
  const client = await pool.connect()
  let invitationId: string
  let organizationName: string
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM invitations WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL', [organizationId, parsed.data.email])
    const organization = await client.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [organizationId])
    if (!organization.rows[0]) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Organization not found.' })
      return
    }
    organizationName = organization.rows[0].name
    const result = await client.query<{ id: string }>(
      `INSERT INTO invitations (organization_id, email, role, project_ids, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 * interval '1 hour'))
       RETURNING id`,
      [organizationId, parsed.data.email, parsed.data.role, parsed.data.projectIds, hashToken(token), auth.userId, config.INVITATION_TTL_HOURS],
    )
    invitationId = result.rows[0].id
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  try {
    await sendOrganizationInvite(parsed.data.email, organizationName!, token)
  } catch (error) {
    await pool.query('DELETE FROM invitations WHERE id = $1 AND accepted_at IS NULL', [invitationId!])
    console.error('Unable to send organization invitation email.', error)
    res.status(503).json({ error: error instanceof Error ? error.message : 'Invitation email could not be sent.' })
    return
  }
  res.status(201).json({ email: parsed.data.email, role: parsed.data.role, expiresInHours: config.INVITATION_TTL_HOURS })
})

app.get('/api/organizations/:organizationId/workspace', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  if (!auth || !organizationId) return
  const role = await getOrganizationRole(organizationId, auth.userId)
  if (!role) {
    res.status(404).json({ error: 'Organization not found.' })
    return
  }
  const projects = await pool.query(
    `SELECT p.id, p.organization_id, p.project_key, p.name, p.description, p.color, p.issue_counter
     FROM projects p
     WHERE p.organization_id = $1
       AND ($2::text IN ('owner', 'admin') OR EXISTS (
         SELECT 1 FROM project_memberships pm
         WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id AND pm.user_id = $3
       ))
     ORDER BY p.created_at, p.name`,
    [organizationId, role, auth.userId],
  )
  const projectIds = projects.rows.map((project) => project.id as string)
  const issues = projectIds.length
    ? await pool.query(
        `SELECT i.id, i.project_id, p.project_key, i.issue_number, i.issue_type, i.summary, i.description,
                i.status, i.priority, i.assignee_id, COALESCE(assignee.display_name, 'Unassigned') AS assignee,
                i.start_date, i.due_date, i.labels,
                COALESCE(
                  json_agg(json_build_object(
                    'id', c.id,
                    'author', author.display_name,
                    'body', c.body,
                    'createdAt', c.created_at
                  ) ORDER BY c.created_at) FILTER (WHERE c.id IS NOT NULL),
                  '[]'::json
                ) AS comments,
                COALESCE(
                  (
                    SELECT json_agg(json_build_object(
                      'id', s.id,
                      'title', s.title,
                      'completed', s.completed
                    ) ORDER BY s.position, s.created_at)
                    FROM issue_subtasks s
                    WHERE s.issue_id = i.id AND s.organization_id = i.organization_id
                  ),
                  '[]'::json
                ) AS subtasks
         FROM issues i
         JOIN projects p ON p.id = i.project_id AND p.organization_id = i.organization_id
         LEFT JOIN users assignee ON assignee.id = i.assignee_id
         LEFT JOIN issue_comments c ON c.issue_id = i.id AND c.organization_id = i.organization_id
         LEFT JOIN users author ON author.id = c.author_id
         WHERE i.organization_id = $1 AND i.project_id = ANY($2::uuid[])
         GROUP BY i.id, p.project_key, assignee.display_name
         ORDER BY i.issue_number`,
        [organizationId, projectIds],
      )
    : { rows: [] }

  const tasksByProject = new Map<string, unknown[]>()
  for (const row of issues.rows) {
    const tasks = tasksByProject.get(row.project_id as string) ?? []
    const startDate = row.start_date as Date | null
    const dueDate = row.due_date as Date | null
    tasks.push({
      id: row.id,
      key: `${row.project_key}-${row.issue_number}`,
      issueType: row.issue_type,
      title: row.summary,
      description: row.description,
      stage: row.status,
      priority: row.priority,
      assignee: row.assignee,
      assigneeId: row.assignee_id,
      startDate: startDate ? dateOnly(startDate) : '',
      dueDate: dueDate ? dateOnly(dueDate) : '',
      labels: row.labels,
      comments: row.comments,
      subtasks: row.subtasks ?? [],
    })
    tasksByProject.set(row.project_id as string, tasks)
  }

  const membersResult = await pool.query(
    `SELECT u.id, u.email, u.display_name, m.role,
            COALESCE(array_agg(DISTINCT pm.project_id) FILTER (WHERE pm.project_id IS NOT NULL), '{}') AS project_ids,
            count(DISTINCT i.id) FILTER (WHERE i.status <> 'Done')::int AS open_issues,
            count(DISTINCT i.id) FILTER (WHERE i.status = 'Done')::int AS completed_issues,
            count(DISTINCT i.id) FILTER (
              WHERE i.status <> 'Done' AND i.due_date < CURRENT_DATE
            )::int AS overdue_issues
     FROM organization_memberships m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN project_memberships pm ON pm.organization_id = m.organization_id AND pm.user_id = m.user_id
       AND pm.project_id = ANY($3::uuid[])
     LEFT JOIN issues i ON i.organization_id = m.organization_id AND i.project_id = pm.project_id AND i.assignee_id = u.id
     WHERE m.organization_id = $1
       AND ($2::text IN ('owner', 'admin') OR m.user_id = $4 OR EXISTS (
         SELECT 1 FROM project_memberships shared
         WHERE shared.organization_id = m.organization_id AND shared.user_id = m.user_id
           AND shared.project_id = ANY($3::uuid[])
       ))
     GROUP BY u.id, u.email, u.display_name, m.role
     ORDER BY u.display_name`,
    [organizationId, role, projectIds, auth.userId],
  )

  const invitations = role === 'owner' || role === 'admin'
    ? await pool.query(
        `SELECT id, email, role, project_ids, expires_at
         FROM invitations
         WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC`,
        [organizationId],
      )
    : { rows: [] }

  res.json({
    role,
    projects: projects.rows.map((project) => ({
      id: project.id,
      organizationId: project.organization_id,
      key: project.project_key,
      name: project.name,
      description: project.description,
      color: project.color,
      issueCounter: project.issue_counter,
      tasks: tasksByProject.get(project.id as string) ?? [],
    })),
    members: membersResult.rows.map((member) => ({
      id: member.id,
      email: member.email,
      name: member.display_name,
      initials: (member.display_name as string).split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase(),
      color: avatarColor(member.id as string),
      role: member.role,
      projectIds: member.project_ids,
      openIssues: member.open_issues,
      completedIssues: member.completed_issues,
      overdueIssues: member.overdue_issues,
    })),
    invitations: invitations.rows,
  })
})

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  description: z.string().trim().max(500).default(''),
})

app.post('/api/organizations/:organizationId/projects', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const parsed = createProjectSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) })
    return
  }
  const role = await getOrganizationRole(organizationId, auth.userId)
  if (!requireAdmin(role, res)) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const project = await client.query(
      `INSERT INTO projects (organization_id, project_key, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, organization_id, project_key, name, description, color, issue_counter`,
      [organizationId, parsed.data.key, parsed.data.name, parsed.data.description, auth.userId],
    )
    await client.query(
      'INSERT INTO project_memberships (organization_id, project_id, user_id) VALUES ($1, $2, $3)',
      [organizationId, project.rows[0].id, auth.userId],
    )
    await client.query('COMMIT')
    const row = project.rows[0]
    res.status(201).json({
      id: row.id,
      organizationId: row.organization_id,
      key: row.project_key,
      name: row.name,
      description: row.description,
      color: row.color,
      issueCounter: row.issue_counter,
      tasks: [],
    })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

function dateOnly(value: Date | string) {
  if (typeof value === 'string') return value.slice(0, 10)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function avatarColor(id: string) {
  const palette = ['indigo', 'peach', 'blue', 'green']
  const index = Number.parseInt(id.replaceAll('-', '').slice(-6), 16) % palette.length
  return palette[index]
}

async function getAccessibleProject(organizationId: string, projectId: string, auth: AuthContext) {
  const role = await getOrganizationRole(organizationId, auth.userId)
  if (!role) return null
  const result = await pool.query<{ id: string }>(
    `SELECT p.id FROM projects p
     WHERE p.id = $1 AND p.organization_id = $2
       AND ($3::text IN ('owner', 'admin') OR EXISTS (
         SELECT 1 FROM project_memberships pm
         WHERE pm.organization_id = p.organization_id AND pm.project_id = p.id AND pm.user_id = $4
       ))`,
    [projectId, organizationId, role, auth.userId],
  )
  return result.rows[0] ? { role, projectId: result.rows[0].id } : null
}

const subtaskInputSchema = z.object({
  id: uuidSchema.optional(),
  title: z.string().trim().min(1).max(255),
  completed: z.boolean().default(false),
})

const issueSchema = z.object({
  id: uuidSchema.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).default(''),
  issueType: z.enum(['Task', 'Story', 'Bug']).default('Task'),
  stage: z.enum(['Backlog', 'To do', 'In progress', 'Review', 'Done']).default('To do'),
  priority: z.enum(['Urgent', 'High', 'Medium', 'Low']).default('Medium'),
  assigneeId: uuidSchema.nullable().default(null),
  startDate: z.union([z.literal(''), z.iso.date()]).default(''),
  dueDate: z.union([z.literal(''), z.iso.date()]).default(''),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  subtasks: z.array(subtaskInputSchema).default([]),
}).refine((issue) => !issue.startDate || !issue.dueDate || issue.startDate <= issue.dueDate, {
  message: 'Start date must not be after the due date.',
})

app.post('/api/organizations/:organizationId/projects/:projectId/issues', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const projectId = uuidSchema.safeParse(req.params.projectId)
  const parsed = issueSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!projectId.success || !parsed.success) {
    res.status(400).json({ error: !projectId.success ? 'Project ID is invalid.' : parsed.success ? 'Issue is invalid.' : z.prettifyError(parsed.error) })
    return
  }
  const project = await getAccessibleProject(organizationId, projectId.data, auth)
  if (!project) {
    res.status(404).json({ error: 'Project not found.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const number = await client.query<{ issue_counter: number }>(
      'UPDATE projects SET issue_counter = issue_counter + 1 WHERE id = $1 AND organization_id = $2 RETURNING issue_counter - 1 AS issue_counter',
      [projectId.data, organizationId],
    )
    const input = parsed.data
    const issue = await client.query(
      `INSERT INTO issues (
         id, organization_id, project_id, issue_number, issue_type, summary, description,
         status, priority, assignee_id, start_date, due_date, labels, created_by
       ) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, '')::date, NULLIF($12, '')::date, $13, $14)
       RETURNING id, issue_number`,
      [input.id ?? null, organizationId, projectId.data, number.rows[0].issue_counter, input.issueType, input.title, input.description, input.stage, input.priority, input.assigneeId, input.startDate, input.dueDate, input.labels, auth.userId],
    )
    if (input.subtasks && input.subtasks.length > 0) {
      for (let i = 0; i < input.subtasks.length; i++) {
        const item = input.subtasks[i]
        await client.query(
          `INSERT INTO issue_subtasks (id, organization_id, issue_id, title, completed, position)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6)`,
          [item.id ?? null, organizationId, issue.rows[0].id, item.title, item.completed, i],
        )
      }
    }
    await client.query('COMMIT')
    res.status(201).json({ id: issue.rows[0].id, key: `${(await getProjectKey(projectId.data, organizationId))}-${issue.rows[0].issue_number}` })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

async function getProjectKey(projectId: string, organizationId: string) {
  const result = await pool.query<{ project_key: string }>(
    'SELECT project_key FROM projects WHERE id = $1 AND organization_id = $2',
    [projectId, organizationId],
  )
  return result.rows[0]?.project_key ?? 'PROJ'
}

app.patch('/api/organizations/:organizationId/issues/:issueId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const issueId = uuidSchema.safeParse(req.params.issueId)
  const parsed = issueSchema.partial().safeParse(req.body)
  if (!auth || !organizationId) return
  if (!issueId.success || !parsed.success || !Object.keys(parsed.data).length) {
    res.status(400).json({ error: 'Issue update is invalid.' })
    return
  }
  const issueResult = await pool.query<{ project_id: string }>(
    'SELECT project_id FROM issues WHERE id = $1 AND organization_id = $2',
    [issueId.data, organizationId],
  )
  const issue = issueResult.rows[0]
  const project = issue ? await getAccessibleProject(organizationId, issue.project_id, auth) : null
  if (!project) {
    res.status(404).json({ error: 'Issue not found.' })
    return
  }
  const existing = await pool.query(
    'SELECT issue_type AS "issueType", summary AS title, description, status AS stage, priority, assignee_id AS "assigneeId", start_date AS "startDate", due_date AS "dueDate", labels FROM issues WHERE id = $1 AND organization_id = $2',
    [issueId.data, organizationId],
  )
  const merged = issueSchema.safeParse({ ...existing.rows[0], ...parsed.data, startDate: normalizeDateInput(parsed.data.startDate ?? existing.rows[0].startDate), dueDate: normalizeDateInput(parsed.data.dueDate ?? existing.rows[0].dueDate) })
  if (!merged.success) {
    res.status(400).json({ error: z.prettifyError(merged.error) })
    return
  }
  const value = merged.data
  await pool.query(
    `UPDATE issues SET issue_type = $3, summary = $4, description = $5, status = $6,
       priority = $7, assignee_id = $8, start_date = NULLIF($9, '')::date,
       due_date = NULLIF($10, '')::date, labels = $11, updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [issueId.data, organizationId, value.issueType, value.title, value.description, value.stage, value.priority, value.assigneeId, value.startDate, value.dueDate, value.labels],
  )
  res.status(204).end()
})

function normalizeDateInput(value: unknown) {
  if (!value) return ''
  if (value instanceof Date) return dateOnly(value)
  return typeof value === 'string' ? value.slice(0, 10) : value
}

app.delete('/api/organizations/:organizationId/issues/:issueId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const issueId = uuidSchema.safeParse(req.params.issueId)
  if (!auth || !organizationId) return
  if (!issueId.success) {
    res.status(400).json({ error: 'Issue ID is invalid.' })
    return
  }
  const issue = await pool.query<{ project_id: string }>(
    'SELECT project_id FROM issues WHERE id = $1 AND organization_id = $2',
    [issueId.data, organizationId],
  )
  const project = issue.rows[0] ? await getAccessibleProject(organizationId, issue.rows[0].project_id, auth) : null
  if (!project) {
    res.status(404).json({ error: 'Issue not found.' })
    return
  }
  await pool.query('DELETE FROM issues WHERE id = $1 AND organization_id = $2', [issueId.data, organizationId])
  res.status(204).end()
})

const commentSchema = z.object({ body: z.string().trim().min(1).max(5000) })

app.post('/api/organizations/:organizationId/issues/:issueId/comments', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const issueId = uuidSchema.safeParse(req.params.issueId)
  const parsed = commentSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!issueId.success || !parsed.success) {
    res.status(400).json({ error: 'Comment is invalid.' })
    return
  }
  const issue = await pool.query<{ project_id: string }>(
    'SELECT project_id FROM issues WHERE id = $1 AND organization_id = $2',
    [issueId.data, organizationId],
  )
  const project = issue.rows[0] ? await getAccessibleProject(organizationId, issue.rows[0].project_id, auth) : null
  if (!project) {
    res.status(404).json({ error: 'Issue not found.' })
    return
  }
  const result = await pool.query(
    `INSERT INTO issue_comments (organization_id, issue_id, author_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [organizationId, issueId.data, auth.userId, parsed.data.body],
  )
  res.status(201).json({ id: result.rows[0].id, createdAt: result.rows[0].created_at })
})

app.patch('/api/organizations/:organizationId/comments/:commentId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const commentId = uuidSchema.safeParse(req.params.commentId)
  const parsed = commentSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!commentId.success || !parsed.success) {
    res.status(400).json({ error: 'Comment update is invalid.' })
    return
  }
  const result = await pool.query(
    `UPDATE issue_comments c SET body = $4, updated_at = now()
     WHERE c.id = $1 AND c.organization_id = $2 AND c.author_id = $3
       AND EXISTS (
         SELECT 1 FROM issues i
         WHERE i.id = c.issue_id AND i.organization_id = c.organization_id
           AND (
             EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = i.organization_id AND m.user_id = $3 AND m.role IN ('owner', 'admin'))
             OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.organization_id = i.organization_id AND pm.project_id = i.project_id AND pm.user_id = $3)
           )
       )
     RETURNING c.id`,
    [commentId.data, organizationId, auth.userId, parsed.data.body],
  )
  if (!result.rowCount) {
    res.status(404).json({ error: 'Comment not found or cannot be edited by this account.' })
    return
  }
  res.status(204).end()
})

app.delete('/api/organizations/:organizationId/comments/:commentId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const commentId = uuidSchema.safeParse(req.params.commentId)
  if (!auth || !organizationId) return
  if (!commentId.success) {
    res.status(400).json({ error: 'Comment ID is invalid.' })
    return
  }
  const result = await pool.query(
    `DELETE FROM issue_comments c
     WHERE c.id = $1 AND c.organization_id = $2
       AND (
         c.author_id = $3 OR EXISTS (
           SELECT 1 FROM organization_memberships m
           WHERE m.organization_id = c.organization_id AND m.user_id = $3 AND m.role IN ('owner', 'admin')
         )
       )
       AND EXISTS (
         SELECT 1 FROM issues i
         WHERE i.id = c.issue_id AND i.organization_id = c.organization_id
           AND (
             EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = i.organization_id AND m.user_id = $3 AND m.role IN ('owner', 'admin'))
             OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.organization_id = i.organization_id AND pm.project_id = i.project_id AND pm.user_id = $3)
           )
       )
     RETURNING c.id`,
    [commentId.data, organizationId, auth.userId],
  )
  if (!result.rowCount) {
    res.status(404).json({ error: 'Comment not found or cannot be deleted by this account.' })
    return
  }
  res.status(204).end()
})

const subtaskSchema = z.object({
  title: z.string().trim().min(1).max(255),
  completed: z.boolean().default(false),
})

const updateSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  completed: z.boolean().optional(),
}).strict().refine((data) => data.title !== undefined || data.completed !== undefined, {
  message: 'At least one field must be provided.',
})

app.post('/api/organizations/:organizationId/issues/:issueId/subtasks', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const issueId = uuidSchema.safeParse(req.params.issueId)
  const parsed = subtaskSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!issueId.success || !parsed.success) {
    res.status(400).json({ error: 'Subtask is invalid.' })
    return
  }
  const issue = await pool.query<{ project_id: string }>(
    'SELECT project_id FROM issues WHERE id = $1 AND organization_id = $2',
    [issueId.data, organizationId],
  )
  const project = issue.rows[0] ? await getAccessibleProject(organizationId, issue.rows[0].project_id, auth) : null
  if (!project) {
    res.status(404).json({ error: 'Issue not found.' })
    return
  }
  const posResult = await pool.query<{ next_pos: number }>(
    'SELECT COALESCE(MAX(position) + 1, 0) AS next_pos FROM issue_subtasks WHERE issue_id = $1 AND organization_id = $2',
    [issueId.data, organizationId],
  )
  const position = posResult.rows[0]?.next_pos ?? 0
  const result = await pool.query(
    `INSERT INTO issue_subtasks (organization_id, issue_id, title, completed, position)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, completed`,
    [organizationId, issueId.data, parsed.data.title, parsed.data.completed, position],
  )
  res.status(201).json(result.rows[0])
})

app.patch('/api/organizations/:organizationId/subtasks/:subtaskId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const subtaskId = uuidSchema.safeParse(req.params.subtaskId)
  const parsed = updateSubtaskSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!subtaskId.success || !parsed.success) {
    res.status(400).json({ error: 'Subtask update is invalid.' })
    return
  }
  const fields: string[] = []
  const values: unknown[] = [subtaskId.data, organizationId, auth.userId]
  let idx = 4
  if (parsed.data.title !== undefined) {
    fields.push(`title = $${idx++}`)
    values.push(parsed.data.title)
  }
  if (parsed.data.completed !== undefined) {
    fields.push(`completed = $${idx++}`)
    values.push(parsed.data.completed)
  }
  fields.push('updated_at = now()')

  const result = await pool.query(
    `UPDATE issue_subtasks s SET ${fields.join(', ')}
     WHERE s.id = $1 AND s.organization_id = $2
       AND EXISTS (
         SELECT 1 FROM issues i
         WHERE i.id = s.issue_id AND i.organization_id = s.organization_id
           AND (
             EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = i.organization_id AND m.user_id = $3 AND m.role IN ('owner', 'admin'))
             OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.organization_id = i.organization_id AND pm.project_id = i.project_id AND pm.user_id = $3)
           )
       )
     RETURNING s.id, s.title, s.completed`,
    values,
  )
  if (!result.rowCount) {
    res.status(404).json({ error: 'Subtask not found or cannot be edited by this account.' })
    return
  }
  res.status(200).json(result.rows[0])
})

app.delete('/api/organizations/:organizationId/subtasks/:subtaskId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const subtaskId = uuidSchema.safeParse(req.params.subtaskId)
  if (!auth || !organizationId) return
  if (!subtaskId.success) {
    res.status(400).json({ error: 'Subtask ID is invalid.' })
    return
  }
  const result = await pool.query(
    `DELETE FROM issue_subtasks s
     WHERE s.id = $1 AND s.organization_id = $2
       AND EXISTS (
         SELECT 1 FROM issues i
         WHERE i.id = s.issue_id AND i.organization_id = s.organization_id
           AND (
             EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = i.organization_id AND m.user_id = $3 AND m.role IN ('owner', 'admin'))
             OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.organization_id = i.organization_id AND pm.project_id = i.project_id AND pm.user_id = $3)
           )
       )
     RETURNING s.id`,
    [subtaskId.data, organizationId, auth.userId],
  )
  if (!result.rowCount) {
    res.status(404).json({ error: 'Subtask not found or cannot be deleted by this account.' })
    return
  }
  res.status(204).end()
})

const memberAllocationSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  projectIds: z.array(uuidSchema).max(100).optional(),
}).strict().refine((input) => input.role !== undefined || input.projectIds !== undefined, {
  message: 'Provide a role or project allocation to update.',
})

app.patch('/api/organizations/:organizationId/members/:userId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const userId = uuidSchema.safeParse(req.params.userId)
  const parsed = memberAllocationSchema.safeParse(req.body)
  if (!auth || !organizationId) return
  if (!userId.success || !parsed.success) {
    res.status(400).json({ error: 'Member update is invalid.' })
    return
  }
  const role = await getOrganizationRole(organizationId, auth.userId)
  if (!requireAdmin(role, res)) return
  if (parsed.data.role && role !== 'owner') {
    res.status(403).json({ error: 'Only the organization owner can change member roles.' })
    return
  }
  const target = await pool.query<{ role: OrganizationRole }>(
    'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId.data],
  )
  if (!target.rows[0] || target.rows[0].role === 'owner') {
    res.status(404).json({ error: 'Member not found or member role cannot be changed.' })
    return
  }
  const projectIds = parsed.data.projectIds
  if (projectIds) {
    const allowedProjects = role === 'owner' || role === 'admin'
      ? await pool.query('SELECT id FROM projects WHERE organization_id = $1 AND id = ANY($2::uuid[])', [organizationId, projectIds])
      : { rowCount: 0 }
    if (allowedProjects.rowCount !== new Set(projectIds).size) {
      res.status(400).json({ error: 'One or more allocated projects do not belong to this organization.' })
      return
    }
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (parsed.data.role) {
      await client.query(
        'UPDATE organization_memberships SET role = $3 WHERE organization_id = $1 AND user_id = $2 AND role <> $4',
        [organizationId, userId.data, parsed.data.role, 'owner'],
      )
    }
    if (projectIds) {
      await client.query(
        `UPDATE issues SET assignee_id = NULL
         WHERE organization_id = $1 AND assignee_id = $2
           AND NOT (project_id = ANY($3::uuid[]))`,
        [organizationId, userId.data, projectIds],
      )
      await client.query(
        `DELETE FROM project_memberships
         WHERE organization_id = $1 AND user_id = $2 AND NOT (project_id = ANY($3::uuid[]))`,
        [organizationId, userId.data, projectIds],
      )
      if (projectIds.length) {
        await client.query(
          `INSERT INTO project_memberships (organization_id, project_id, user_id)
           SELECT $1, allocated.project_id, $2 FROM unnest($3::uuid[]) AS allocated(project_id)
           ON CONFLICT DO NOTHING`,
          [organizationId, userId.data, projectIds],
        )
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  res.status(204).end()
})

app.delete('/api/organizations/:organizationId/members/:userId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const userId = uuidSchema.safeParse(req.params.userId)
  if (!auth || !organizationId) return
  if (!userId.success) {
    res.status(400).json({ error: 'Member ID is invalid.' })
    return
  }
  const role = await getOrganizationRole(organizationId, auth.userId)
  if (!requireAdmin(role, res)) return
  const target = await pool.query<{ role: OrganizationRole }>(
    'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId.data],
  )
  if (!target.rows[0] || target.rows[0].role === 'owner') {
    res.status(404).json({ error: 'Member not found or organization owner cannot be removed.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE issues SET assignee_id = NULL WHERE organization_id = $1 AND assignee_id = $2', [organizationId, userId.data])
    await client.query('DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2', [organizationId, userId.data])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  res.status(204).end()
})

app.delete('/api/organizations/:organizationId/invitations/:invitationId', async (req, res) => {
  const auth = requireAuth(req, res)
  const organizationId = parseOrganizationId(req, res)
  const invitationId = uuidSchema.safeParse(req.params.invitationId)
  if (!auth || !organizationId) return
  if (!invitationId.success) {
    res.status(400).json({ error: 'Invitation ID is invalid.' })
    return
  }
  const role = await getOrganizationRole(organizationId, auth.userId)
  if (!requireAdmin(role, res)) return
  const result = await pool.query(
    'DELETE FROM invitations WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL RETURNING id',
    [invitationId.data, organizationId],
  )
  if (!result.rowCount) {
    res.status(404).json({ error: 'Pending invitation not found.' })
    return
  }
  res.status(204).end()
})

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isUniqueViolation(error)) {
    res.status(409).json({ error: 'A record with those details already exists.' })
    return
  }
  console.error('Unhandled API error.', error)
  res.status(500).json({ error: 'The request could not be completed.' })
})

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export { app }
