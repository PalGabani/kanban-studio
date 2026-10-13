import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { app } from '../app.js'
import { pool } from '../db.js'
import { createSecret, hashToken } from '../security.js'

test('organizations cannot read or mutate another tenant project data', async () => {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The API did not bind to a TCP port.')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const suffix = randomUUID()
  const emails = [
    `tenant-a-${suffix}@example.test`,
    `tenant-b-${suffix}@example.test`,
    `invited-user-${suffix}@example.test`,
  ]
  const organizationIds: string[] = []
  const userIds: string[] = []

  async function request(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { Origin: process.env.APP_ORIGIN ?? 'http://localhost:5173' }
    if (options.cookie) headers.Cookie = options.cookie
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const text = await response.text()
    return {
      response,
      body: text ? JSON.parse(text) as Record<string, unknown> : null,
    }
  }

  try {
    const accounts = []
    for (const [index, email] of emails.entries()) {
      const registration = await request('/api/auth/register', {
        method: 'POST',
        body: {
          email,
          password: `Integration password ${index} is strong!`,
          displayName: `Tenant ${index}`,
          organizationName: `Integration tenant ${index} ${suffix}`,
        },
      })
      assert.equal(registration.response.status, 201)
      const account = registration.body as {
        user: { id: string }
        organization: { id: string }
      }
      userIds.push(account.user.id)
      organizationIds.push(account.organization.id)
      accounts.push({
        userId: account.user.id,
        organizationId: account.organization.id,
        cookie: registration.response.headers.get('set-cookie')?.split(';')[0] ?? '',
      })
      assert.ok(accounts[index].cookie)
    }

    const [owner, other, invitedUser] = accounts
    const project = await request(`/api/organizations/${owner.organizationId}/projects`, {
      cookie: owner.cookie,
      method: 'POST',
      body: { name: 'Tenant-only project', key: `T${suffix.replaceAll('-', '').slice(0, 8).toUpperCase()}`, description: '' },
    })
    assert.equal(project.response.status, 201)
    const projectId = (project.body as { id: string }).id
    const privateProject = await request(`/api/organizations/${owner.organizationId}/projects`, {
      cookie: owner.cookie,
      method: 'POST',
      body: { name: 'Unallocated project', key: `P${suffix.replaceAll('-', '').slice(0, 8).toUpperCase()}`, description: '' },
    })
    assert.equal(privateProject.response.status, 201)
    const issueId = randomUUID()
    const issue = await request(`/api/organizations/${owner.organizationId}/projects/${projectId}/issues`, {
      cookie: owner.cookie,
      method: 'POST',
      body: {
        id: issueId,
        title: 'Private tenant issue',
        description: '',
        issueType: 'Task',
        stage: 'To do',
        priority: 'Medium',
        assigneeId: owner.userId,
        startDate: '',
        dueDate: '',
        labels: [],
      },
    })
    assert.equal(issue.response.status, 201)
    const comment = await request(`/api/organizations/${owner.organizationId}/issues/${issueId}/comments`, {
      cookie: owner.cookie,
      method: 'POST',
      body: { body: 'Persisted within the owning tenant' },
    })
    assert.equal(comment.response.status, 201)

    const otherWorkspace = await request(`/api/organizations/${other.organizationId}/workspace`, { cookie: other.cookie })
    assert.equal(otherWorkspace.response.status, 200)
    assert.deepEqual((otherWorkspace.body as { projects: unknown[] }).projects, [])

    const crossTenantDelete = await request(`/api/organizations/${owner.organizationId}/issues/${issueId}`, {
      cookie: other.cookie,
      method: 'DELETE',
    })
    assert.equal(crossTenantDelete.response.status, 404)

    const invitationToken = createSecret()
    const invitationEmail = emails[2]
    await pool.query(
      `INSERT INTO invitations (organization_id, email, role, project_ids, token_hash, invited_by, expires_at)
       VALUES ($1, $2, 'member', $3, $4, $5, now() + interval '1 hour')`,
      [owner.organizationId, invitationEmail, [projectId], hashToken(invitationToken), owner.userId],
    )
    const inspectedInvite = await request(`/api/invitations/inspect?token=${encodeURIComponent(invitationToken)}`)
    assert.equal(inspectedInvite.response.status, 200)
    assert.equal((inspectedInvite.body as { email: string }).email, invitationEmail)

    const wrongAccountAcceptance = await request('/api/invitations/accept', {
      cookie: other.cookie,
      method: 'POST',
      body: { token: invitationToken, displayName: 'Invited teammate' },
    })
    assert.equal(wrongAccountAcceptance.response.status, 409)
    const acceptedInvite = await request('/api/invitations/accept', {
      cookie: invitedUser.cookie,
      method: 'POST',
      body: { token: invitationToken, displayName: 'Invited teammate' },
    })
    assert.equal(acceptedInvite.response.status, 200)
    const memberWorkspace = await request(`/api/organizations/${owner.organizationId}/workspace`, { cookie: invitedUser.cookie })
    assert.equal(memberWorkspace.response.status, 200)
    const memberProjects = (memberWorkspace.body as { projects: { id: string }[] }).projects
    assert.deepEqual(memberProjects.map((item) => item.id), [projectId])
    const forbiddenProjectCreation = await request(`/api/organizations/${owner.organizationId}/projects`, {
      cookie: invitedUser.cookie,
      method: 'POST',
      body: { name: 'Not allowed', key: `N${suffix.replaceAll('-', '').slice(0, 8).toUpperCase()}`, description: '' },
    })
    assert.equal(forbiddenProjectCreation.response.status, 403)

    const ownerWorkspace = await request(`/api/organizations/${owner.organizationId}/workspace`, { cookie: owner.cookie })
    assert.equal(ownerWorkspace.response.status, 200)
    const ownerProjects = (ownerWorkspace.body as { projects: { id: string; tasks: { comments: { body: string }[] }[] }[] }).projects
    assert.equal(ownerProjects.length, 2)
    assert.equal(ownerProjects.find((item) => item.id === projectId)?.tasks[0].comments[0].body, 'Persisted within the owning tenant')
  } finally {
    try {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizationIds])
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds])
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await pool.end()
    }
  }
})
