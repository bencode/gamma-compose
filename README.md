# Gamma Compose

A browser workbench for building React pages. Project files live in the browser;
a stateless Node service compiles them into JavaScript and CSS, which run in an
isolated preview.

## Current iteration: Local projects and chats

- A resizable conversation panel and full-height preview or syntax-highlighted, read-only file browser.
- One project entry and a browser-owned text-file tree compiled into static ESM modules.
- React, built-in shadcn/Radix components, Tailwind CSS 4, and ordinary CSS bundled together.
- A runnable team workspace with project search, a status filter, and a dialog.
- A gallery with Blank, Team workspace, and Product showcase templates.
- Independent browser-local projects with automatic IndexedDB file saving.
- Browser-local chats that restore their complete transcript per project.
- Compilation diagnostics, preview loading errors, runtime errors, and retry.
- All project copy, comments, and documentation are in English.
- A browser-side Pi Agent with multi-turn GLM Coding Plan chat, streaming replies, and Stop.
- One compact composer surface showing browser-local save state and the active model.
- Browser-local file and structured-data tools, plus explicit `compile` and `refresh_preview`.
- Agent file changes immediately appear in Files; compile caches a build and refresh loads it.
- Project-scoped application data backed by host-owned IndexedDB and validated JSON resource models.

The Agent can inspect and modify the selected project, create text files, operate on
project-local structured data, compile the current entry, and refresh the preview.
Compile diagnostics return to the Agent for source repair. Writes do not automatically
compile or refresh. Stop keeps completed changes and cancels
active generation or compilation; it does not roll back files.
Project files and completed chat messages save automatically in IndexedDB. The latest
chat reopens with its transcript; drafts and unsent attachment selections clear when
leaving the workbench or refreshing. Desktop panel proportions are saved separately
in this browser's localStorage.
There is no source editor, Scene compiler, or module registry.
There is no search tool, shell, package installation, deletion, or rename tool.
See [Agent project tools](docs/agent-project-tools.md) for the technical flow.

## Gallery and local projects

Open `/` to choose a template or an existing project. Choosing a template creates
an independent copy and opens `/projects/:projectId`; choosing an existing project
reopens it without copying. The workbench's back arrow returns to the gallery.

The `gamma-compose` IndexedDB database (version 4) has `templates`, `projects`,
`compileStates`, `files`, `contents`, `sessions`, and `sessionTranscripts` stores.
Templates are seeded only when the database is created.
Each project stores its name, last-modified timestamp, entry and complete text
file collection. Compile state stores the last successful server build tree by
project ID. Template updates do not overwrite existing browser data.

Every valid file change submits a complete snapshot without a debounce. `Local ✓`
means the latest snapshot's database transaction completed. On `Save failed · Retry`,
changes remain in memory and Retry resubmits them. Wait for `Local ✓` before
closing the page; only committed changes survive a forced close. Reopening verifies
the saved compile state against the server's current derived tree and rebuilds when needed.

Projects belong to this browser and origin. URLs do not share project data with
other devices. Clearing site data removes projects; browser storage is not a cloud
backup. Database failures are shown with retry, not hidden behind temporary projects.
Deleting a project also deletes its browser-local files, chats, application data, and
compile state. There is no rename UI, export, chat branching, or cross-tab collaboration.

Blank and Product showcase use `MemoryRouter` inside the sandboxed preview.
Preview navigation does not change the editor URL. Do not use `BrowserRouter`
or `HashRouter` inside the preview; the host application uses its own BrowserRouter.

## Development

Use Node 24 and pnpm 10.14.0. From the repository root:

```sh
pnpm install
pnpm dev
```

Open http://localhost:5301. Vite proxies /api to the Hono service on port 3301.
The frontend fails if its port is occupied.

To use a different backend port:

```sh
PORT=3302 GAMMA_BACKEND=http://127.0.0.1:3302 pnpm dev
```

Environment variables come from the shell or deployment environment; .env files
are not loaded automatically.

## Chat configuration

Set `GLM_API_KEY` in the server's shell or deployment environment before running
`pnpm dev` or `pnpm start`. Never put it in a `VITE_` variable or browser storage.
`GLM_MODEL` defaults to `glm-5.3`; another value must exist in the pinned Pi
GLM Coding CN model catalog. The composer displays the active model returned by this
configuration. This iteration has no browser-side provider configuration, model switching,
or silent fallback; the disabled control only establishes the future frontend contract.

The upstream is fixed to `https://open.bigmodel.cn/api/coding/paas/v4`.
Use a GLM Coding Plan credential and confirm that your intended use is permitted
by your provider subscription. Ordinary API credentials are not interchangeable.
Without a key, chat is shown as temporarily unavailable while compilation and preview
remain available. Provider credential names and setup details are not shown in the UI.

The Node service listens on `127.0.0.1` by default; `HOST` can override this for a
controlled deployment. This iteration has no user authentication, rate limiting,
or billing. Do not expose the proxy to anonymous users. Deployments must provide
their own access control before making it remotely accessible.

### Request flow

- `GET /api/agent/config` returns `{ enabled: false }`, or
  `{ enabled: true, provider: 'zai-coding-cn', modelId: string }`, never the key.
- Browser Pi owns the Agent loop, transcript, GLM request encoding, and SSE parsing.
- `POST /api/agent/chat/completions` forwards JSON to the fixed upstream, injecting
  the server key and ignoring browser authentication headers. Requests must use
  the configured model, `stream: true`, a `messages` array, and at most 2 MiB.
- The proxy forwards SSE without buffering a complete answer or storing a session.
  It can see the conversation it forwards; this is not end-to-end encryption.
- Requests have a five-minute limit and no automatic retry. Stop aborts the browser
  request and propagates cancellation upstream; it cannot undo provider charges.
- Partial responses remain visible after failure or cancellation. Pi excludes
  failed/aborted assistant messages from subsequent model requests.
- Assistant text renders as safe GFM Markdown; raw HTML is not executed. Pi
  thinking and tool activity appear in disclosures. Live activity shows its step
  list and folds after completion; each step can reveal bounded input or output.
  User text stays literal. Refresh restores the latest chat and clears its draft.

### Chat acceptance checks

After setting the server credential, send two related messages and verify that
the second response uses the first turn. Stop another response while streaming;
confirm that partial text remains and a new message can be sent. Switch Preview /
Files and resize across the mobile breakpoint during generation; the conversation
must survive. In browser network tools, confirm that no real provider key appears.

Automated tests use simulated model responses and local HTTP connections; they do
not call the paid provider or replace these credential-dependent acceptance checks.
Ask the Agent to change the project table into cards while keeping search and the
status filter. Confirm tool activity appears, inspect actual file changes, and test
the refreshed preview. Compilation success alone does not verify browser behavior;
preview runtime errors are displayed to the user, not fed back to the Agent.

## Checks and production

```sh
pnpm check
pnpm build
pnpm start
```

- check runs Biome, TypeScript, and behavior tests without rewriting files.
- build produces ui-packages/web/dist and web-packages/server/dist.
- start runs the compiled Node server and serves the frontend and API on port 3301.
- Production compilation still needs the complete workspace, installed dependencies,
  and the built-in UI source package. It does not require tsx.
- Build before starting production. Static assets resolve relative to the server
  module, not the current working directory.

## Compilation contract

```http
GET /api/compiler/projects/:projectId/tree

POST /api/compiler/projects/:projectId/builds
Content-Type: application/json
```

```ts
type SourceFileDescriptor = { hash: string; bytes: number }

type CompileBuildInput = {
  baseBuildId: string | null
  entry: string
  sourceTree: Record<string, SourceFileDescriptor>
  changes: Record<string, string>
}

type CompileDiagnostic = {
  message: string
  path?: string
  line?: number
  column?: number
}

type CompiledFile = {
  kind: 'module' | 'style'
  sourceHash: string
  sourceBytes: number
  outputHash: string
  outputPath: string
}

type CompiledTree = {
  projectId: string
  buildId: string
  compilerVersion: string
  entry: string
  files: Record<string, CompiledFile>
  previewUrl: string
}

type CompileResult =
  | { ok: true; build: CompiledTree; warnings: CompileDiagnostic[] }
  | {
      ok: false
      reason: 'invalid-input' | 'stale-tree' | 'compile'
      errors: CompileDiagnostic[]
    }
```

The example entry, src/main.tsx, mounts the application into #root. The compiler
does not require a particular component export or execute the entry on the server.

Limits and resolution:

- Maximum request body: 17 MiB. A project may contain 1 to 1,024 text files and
  up to 16 MiB of serialized project data.
- File keys must be canonical project-relative paths.
- The complete `sourceTree` is sent on every build. `changes` normally contains only
  new or changed source text. When source paths are added or deleted, it also contains
  every non-CSS module so extensionless imports can be resolved again. Deleting a file
  means omitting it from `sourceTree`.
- Local TS, TSX, JS, JSX, JSON, and CSS imports resolve only inside the declared source tree.
- Literal dynamic imports such as `import('./pages/settings')` are supported;
  computed dynamic import paths are rejected.
- Direct package imports: react, react/jsx-runtime, react/jsx-dev-runtime,
  react-dom, react-dom/client, react-router-dom, @gamma-compose/ui,
  @gamma-compose/ui/styles.css, and @gamma-compose/local-db.
- CSS may import tailwindcss. Built-in component dependencies come from the installed workspace.
- Unknown packages, remote modules, filesystem escapes, custom Tailwind plugins,
  JavaScript configuration, and @source directory scanning are rejected.
- No per-request package installation or project build scripts.
- HTTP statuses: 200 success, 400 invalid input, 413 request too large,
  409 stale compiled tree, 422 compilation failure, 500 unexpected service failure.
- Diagnostics use one-based lines and columns when a project location is available.
  Runtime errors are not mapped back to TSX; full TypeScript type checking is not included.

Tailwind scans all compiled project modules and the built-in component sources.
Use complete class names, not expressions such as bg-${color}-500. Custom CSS
and theme variables are supported.

The browser owns the complete source workspace in IndexedDB and keeps the latest
successful compiled tree in a separate `compileStates` record. The server stores no
source workspace or Agent session. It only publishes rebuildable derived artifacts
under `GAMMA_DATA_DIR` (default `.gamma-data`). If that directory is removed, the tree
endpoint returns 404 and the browser reconstructs the build from its local project.
A 409 means another build changed the current derived tree; the browser reads it and
retries once. Failed builds never replace the current build.

Every declared source module becomes a separate browser ESM file. Local import
specifiers stay unchanged; build-scoped static resolution redirects extensionless
imports to one canonical output URL. Unchanged module and stylesheet artifacts are
hard-linked into the next immutable build, while changed files are transformed again.
React, React DOM, React Router, the built-in UI, and the local database preview client
come from one shared, precompiled runtime import map, preserving a single React instance.
Independent CSS artifacts are reused; final CSS and Tailwind output are rebuilt as one
build stylesheet.

## Built-in components

Import from @gamma-compose/ui:

Button, Input, Textarea, Label, Card, Badge, Select, Checkbox, Dialog, Tabs,
and Table, including their composition subcomponents.

Import @gamma-compose/ui/styles.css once from the project entry.
Components are adapted from the shadcn/ui Radix registry; upstream notices are
retained in ui-packages/ui/THIRD_PARTY_NOTICES.md. This notice does not choose a
license for Gamma Compose itself.

## Preview boundary

The preview runs in an iframe with sandbox="allow-scripts", without same-origin
permission. It owns its DOM and CSS. Its `src` points to the immutable preview URL,
which loads compiled ESM and runtime files through the server's static middleware.
Static responses allow the sandbox's opaque `Origin: null` without granting the
iframe same-origin access. The frame reports lifecycle errors through source-checked
window messages. A transferred MessagePort proxies local
database calls to the host; IndexedDB and Ajv do not run in the iframe.

The preview CSP blocks fetch requests, remote scripts and styles, form submission,
and external image/font resources. Data/blob images are permitted. Popups and top
navigation are not enabled. This is not CPU or memory isolation against malicious
code and is not a complete public multi-tenant execution service.

Switching Preview and Files keeps the loaded iframe mounted. Desktop resizing
keeps both panels at least 180px wide, with a default conversation width of 360px.
After resizing, desktop panel proportions are restored on refresh at the same
origin. Only user resizing saves the preference; mobile layouts do not read or
overwrite it. Unavailable storage or invalid saved layouts fall back to defaults.
Below 900px the layout becomes vertical; changing across that breakpoint can
remount the preview, while preserving the compiled result, draft, and file selection.

## Repository layout

| Directory | Responsibility |
| --- | --- |
| ui-packages/ui | Built-in components and theme source |
| ui-packages/local-db | JSON resource protocol, native IndexedDB runtime, preview bridge, and Agent skill |
| ui-packages/web/src/shell | Workbench layout and shared view state |
| ui-packages/web/src/core | Example project, compilation client, and browser Pi runtime |
| ui-packages/web/src/features | Conversation, file browser, and isolated preview |
| web-packages/server/src/compiler | Compilation contract, validation, resolution, and CSS pipeline |
| web-packages/server/src/agent | Public model configuration and stateless GLM proxy |

## Manual acceptance

1. Open the gallery and create a Team workspace project; confirm it compiles and displays.
2. Search projects, change the status filter, and open/close the dialog using the keyboard.
3. Switch to Files, inspect the entry and component source, then return to Preview.
   The search and filter state should remain unchanged.
4. Enter a conversation draft and verify view changes preserve it.
5. Drag the desktop separator, use its keyboard controls, and double-click to reset.
6. Check a 390px viewport and narrow desktop panels for overflow.
7. Exercise compilation and runtime failures; confirm an English error and a working retry.
8. Start the production build and verify compilation without a development server.
9. Ask the Agent to change the page, wait for Saved, refresh the project URL, and
   verify the modified files and latest completed chat return while the draft is empty.
10. Return to the gallery, reopen the project, then create another from the same
    template. Verify the original project and the template are unchanged.
11. Create Blank and Product showcase projects; check Hello and the expandable FAQ.

GET /api/health remains a diagnostic endpoint; the UI does not poll it.
Unknown /api routes return JSON 404. Unknown application routes show a not-found
page; missing static assets return HTTP 404.

## Next iterations

1. Scene JSON-to-TSX compilation and independently compiled entries, after separate design review.
2. Export and deployment capabilities, after separate design review.
