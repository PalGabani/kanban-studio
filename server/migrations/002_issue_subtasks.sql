CREATE TABLE issue_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 255),
  completed boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (issue_id, organization_id) REFERENCES issues(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX issue_subtasks_issue_idx ON issue_subtasks (organization_id, issue_id, position, created_at);
