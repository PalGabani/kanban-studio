# Kanban Studio

Kanban Studio (Stride) is a Jira-inspired, multi-tenant project and issue tracker. Organizations are isolated workspaces; organization owners and admins manage projects, issues, and invitations, while members see projects to which they are allocated.

## Features

- **Organization workspaces:** create an organization, switch between organizations, and invite teammates by email.
- **Roles and allocation:** owner, admin, and member roles; assign members to projects and revoke access.
- **Projects and issues:** create projects with unique issue keys; create, edit, and delete Tasks, Stories, and Bugs.
- **Kanban workflow:** Backlog, To do, In progress, Review, and Done, with drag-and-drop.
- **Planning views:** project timeline and due-date calendar.
- **Issue details:** descriptions, priority, assignee, start and due dates, labels, and threaded comments.
- **Find work:** search issue content and filter by status, priority, and assignee.
- **SQL persistence:** PostgreSQL stores organizations, memberships, projects, issues, comments, sessions, and invitations.

## Requirements

- Node.js **20.19+** or **22.12+**
- npm
- Docker Desktop (for the local PostgreSQL and Mailpit services)

## Local setup

Run these commands from the repository directory:

```powershell
Copy-Item .env.example .env
```

Set a private local password in `.env` for `POSTGRES_PASSWORD` and use the same value in `DATABASE_URL` (the password portion of the PostgreSQL URL). Do not commit `.env`.

Start PostgreSQL and Mailpit, install dependencies, apply the database migration, and run the app:

```powershell
docker compose up -d database mailpit
npm ci
npm run db:migrate
npm run dev
```

Open <http://localhost:5173>. The API is available through Vite's `/api` proxy. Mailpit's inbox is at <http://localhost:8025>; invitations sent locally can be accepted from that inbox. For SMTP in another environment, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional `SMTP_USER`/`SMTP_PASSWORD`, and `MAIL_FROM`.

The API reads `.env` in its development and migration scripts. `APP_ORIGIN` must match the browser origin used for the app. For a deployed frontend/API pair, configure an HTTPS origin, secure cookie settings, a managed PostgreSQL connection, and a real SMTP provider; do not expose the database publicly.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API and Vite development server |
| `npm run dev:api` | Run only the API in watch mode |
| `npm run dev:web` | Run only the Vite frontend |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run lint` | Lint frontend source |
| `npm run lint:server` | Lint API source |
| `npm test` | Run server unit tests |
| `npm run test:integration` | Run tenant-isolation tests against the configured PostgreSQL database |
| `npm run typecheck:server` | Type-check API source |
| `npm run build` | Type-check and build the frontend |
| `npm run preview` | Preview the production frontend build |

## Stack

- React 19, TypeScript, Vite, and Lucide
- Node.js, Express 5, and PostgreSQL
- Password hashing with Node.js `scrypt`; opaque session and invitation tokens are stored as hashes
- Nodemailer for invitation email delivery

## Tenant and role model

An organization is a tenant. Projects, issues, comments, invitations, and memberships are scoped to that organization in the API and relational schema. Owners manage the organization and can appoint admins. Owners and admins can create projects, invite members, and allocate project access; only owners can grant or change the admin role. Members can access allocated projects. Removing a member revokes their organization membership and unassigns their issues.

The current sign-in is email plus password. WebAuthn/passkey authentication is not implemented. PostgreSQL is in the same database family used by Supabase, so the schema can be migrated there; this app currently uses its own API sessions and authorization checks, not Supabase Auth or Row Level Security. Tenant isolation therefore depends on the API's scoped SQL and should be covered by integration tests before production use.

## Project structure

```text
server/
├── app.ts                 # Auth, tenant-scoped API, and role checks
├── migrations/            # PostgreSQL schema migrations
├── tests/                 # API/server unit tests
├── config.ts              # Validated environment configuration
├── mailer.ts              # Organization invitation email
├── migrate.ts             # SQL migration runner
└── security.ts            # Password and token helpers
src/
├── App.tsx                # Board, timeline, calendar, team, and issue workflows
├── AuthScreen.tsx         # Registration, sign-in, and invitation acceptance
├── api.ts                 # Same-origin API client
├── useWorkspace.ts        # Authentication and organization workspace state
├── styles.css             # Responsive Jira-inspired interface
└── types.ts               # Project, issue, membership, and comment types
```

## Notes

- Do not put production credentials in source control. `.env` is ignored by Git; `.env.example` contains placeholders only.
- Jira is a product of Atlassian. Kanban Studio is an independent application and is not affiliated with or endorsed by Atlassian.
