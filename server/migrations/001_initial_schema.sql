CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_memberships_user_idx ON organization_memberships (user_id, organization_id);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_key text NOT NULL CHECK (project_key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#0c66e4',
  issue_counter integer NOT NULL DEFAULT 1 CHECK (issue_counter > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, project_key),
  UNIQUE (id, organization_id)
);

CREATE INDEX projects_organization_idx ON projects (organization_id, created_at);

CREATE TABLE project_memberships (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, user_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES organization_memberships(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX project_memberships_user_idx ON project_memberships (organization_id, user_id, project_id);

CREATE TABLE issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  issue_number integer NOT NULL CHECK (issue_number > 0),
  issue_type text NOT NULL DEFAULT 'Task' CHECK (issue_type IN ('Task', 'Story', 'Bug')),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('Backlog', 'To do', 'In progress', 'Review', 'Done')),
  priority text NOT NULL CHECK (priority IN ('Urgent', 'High', 'Medium', 'Low')),
  assignee_id uuid,
  start_date date,
  due_date date,
  labels text[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date),
  UNIQUE (project_id, issue_number),
  UNIQUE (id, organization_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, assignee_id) REFERENCES project_memberships(organization_id, project_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX issues_project_status_idx ON issues (organization_id, project_id, status);
CREATE INDEX issues_assignee_idx ON issues (organization_id, assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX issues_due_date_idx ON issues (organization_id, project_id, due_date) WHERE due_date IS NOT NULL;

CREATE TABLE issue_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (issue_id, organization_id) REFERENCES issues(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX issue_comments_issue_idx ON issue_comments (organization_id, issue_id, created_at);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX user_sessions_active_idx ON user_sessions (token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  project_ids uuid[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX invitations_pending_email_idx
  ON invitations (organization_id, email)
  WHERE accepted_at IS NULL;

CREATE INDEX invitations_expiry_idx ON invitations (expires_at) WHERE accepted_at IS NULL;
