# Kanban Studio

**Kanban Studio**, also known as Stride, is a Jira-inspired project and issue tracker with a multi-project Kanban board. Create projects with their own issue keys, organize work across workflow stages, and discuss changes in task activity threads.

> Stride is a frontend demo. Project and issue data is stored in this browser only. There is no backend, account system, or cross-device synchronization.

## Features

- **Projects:** create and switch between projects, each with a unique key such as `WEB`.
- **Kanban workflow:** Backlog, To do, In progress, Review, and Done columns.
- **Issues:** create, edit, and delete Tasks, Stories, and Bugs with sequential keys such as `WEB-15`.
- **Issue details:** set a summary, description, status, priority, assignee, due date, and labels.
- **Drag and drop:** move issues between workflow columns.
- **Comments:** add, edit, and delete comments on issues. New comments are saved immediately.
- **Find work:** search issue keys, summaries, descriptions, labels, assignees, and comments; filter by status, priority, and assignee; sort by priority.
- **Local persistence:** projects and issues are saved in browser `localStorage`; storage errors are surfaced in the UI.
- **Responsive UI:** usable on desktop and smaller screens.

## Requirements

- Node.js **20.19+** or **22.12+**
- npm

## Getting started

From the workspace root, change to the app directory, install dependencies, and start the Vite development server:

```bash
cd kanban-studio
npm ci
npm run dev
```

If you are already in the `kanban-studio` directory, start at `npm ci`.

Open the local URL printed by Vite.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run lint` | Lint application source with Oxlint |
| `npm run build` | Type-check the app and create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |

## Tech stack

- React 19 and TypeScript
- Vite 8
- Lucide React icons
- Browser `localStorage`

## Project structure

```text
src/
├── App.tsx        # Workspace, Kanban board, project and issue workflows
├── data.ts        # Starter project and example issues
├── main.tsx       # React entry point
├── styles.css     # Responsive UI and Jira-inspired design
├── types.ts       # Project, issue, stage, priority, and comment types
└── useProjects.ts # Validated localStorage persistence
```

## Data and limitations

- Starter project data is loaded on first use. After that, changes are saved under the `stride-kanban-projects-v1` localStorage key for this site and browser profile.
- To start fresh, remove that key from the browser's developer tools under **Application/Storage → Local Storage**. This deletes the saved projects for this app in that browser.
- Assignees are sample team members. There is no real user management, notifications, permissions, backend API, or collaboration between browsers.
- Jira is a product of Atlassian. Stride is an independent demo and is not affiliated with or endorsed by Atlassian.
