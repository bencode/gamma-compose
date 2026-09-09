# Gamma Compose

A browser workbench for building React pages. Project files live in the browser;
a stateless Node service compiles them into JavaScript and CSS, which run in an
isolated preview.

## Current iteration: Template gallery and local projects

- A resizable conversation panel and full-height preview or read-only file browser.
- One project entry and a collection of text files submitted to the compiler.
- React, built-in shadcn/Radix components, Tailwind CSS 4, and ordinary CSS bundled together.
- A runnable team workspace with project search, a status filter, and a dialog.
- A gallery with Blank, Team workspace, and Product showcase templates.
- Independent browser-local projects with automatic IndexedDB file saving.
- Compilation diagnostics, preview loading errors, runtime errors, and retry.
- All project copy, comments, and documentation are in English.
- A browser-side Pi Agent with multi-turn GLM Coding Plan chat, streaming replies, and Stop.
- Browser-local file and structured-data tools, plus explicit `compile` and `refresh_preview`.
- Agent file changes immediately appear in Files; compile caches a build and refresh loads it.
- Project-scoped application data backed by host-owned IndexedDB and validated JSON resource models.

The Agent can inspect and modify the selected project, create text files, operate on
project-local structured data, compile the current entry, and refresh the preview.
Compile diagnostics return to the Agent for source repair. Writes do not automatically
compile or refresh. Stop keeps completed changes and cancels
active generation or compilation; it does not roll back files.
Project files save automatically in IndexedDB. Conversation history and drafts
remain in memory and clear when leaving the workbench or refreshing. Desktop
panel proportions are saved separately in this browser's localStorage.
There is no source editor, Scene compiler, or module registry.
There is no search tool, shell, package installation, deletion, or rename tool.
See [Agent project tools](docs/agent-project-tools.md) for the technical flow.

## Gallery and local projects

Open `/` to choose a template or an existing project. Choosing a template creates
an independent copy and opens `/projects/:projectId`; choosing an existing project
reopens it without copying. The workbench's back arrow returns to the gallery.

The `gamma-compose` IndexedDB database (version 1) has `templates` and `projects`
stores keyed by `id`. Templates are seeded only when the database is created.
Each project stores its name, last-modified timestamp, entry and complete text
file collection. Template updates do not overwrite existing browser data.

Every valid file change submits a complete snapshot without a debounce. `Saved`
means the latest snapshot's database transaction completed. On `Save failed`,
changes remain in memory and Retry save resubmits them. Wait for `Saved` before
closing the page; only committed changes survive a forced close. Reopening
compiles the saved source again; compiled bundles are not persisted.

Projects belong to this browser and origin. URLs do not share project data with
other devices. Clearing site data removes projects; browser storage is not a cloud
backup. Database failures are shown with retry, not hidden behind temporary projects.
There is no chat persistence, rename/delete UI, export, history, or cross-tab collaboration.

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
GLM Coding CN model catalog. There is no browser model selector or silent fallback.

The upstream is fixed to `https://open.bigmodel.cn/api/coding/paas/v4`.
Use a GLM Coding Plan credential and confirm that your intended use is permitted
by your provider subscription. Ordinary API credentials are not interchangeable.
Without a key, chat is disabled while compilation and preview remain available.

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
- Replies are plain text, not executable HTML or rendered Markdown. Internal
  reasoning is not displayed. Refresh clears the conversation and draft.

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
POST /api/compile
Content-Type: application/json
```

```ts
type CompileInput = {
  entry: string
  files: Record<string, string>
}

type CompileDiagnostic = {
  message: string
  path?: string
  line?: number
  column?: number
}

type CompileResult =
  | { ok: true; js: string; css: string; warnings: CompileDiagnostic[] }
  | { ok: false; errors: CompileDiagnostic[] }
```

The example entry, src/main.tsx, mounts the application into #root. The compiler
does not require a particular component export or execute the entry on the server.

Limits and resolution:

- Maximum request body: 2 MiB. Between 1 and 128 text files.
- File keys must be canonical project-relative paths.
- Local TS, TSX, JS, JSX, JSON, and CSS imports resolve only inside the submitted file collection.
- Direct package imports: react, react/jsx-runtime, react/jsx-dev-runtime,
  react-dom, react-dom/client, react-router-dom, @gamma-compose/ui,
  @gamma-compose/ui/styles.css, and @gamma-compose/local-db.
- CSS may import tailwindcss. Built-in component dependencies come from the installed workspace.
- Unknown packages, remote modules, filesystem escapes, custom Tailwind plugins,
  JavaScript configuration, and @source directory scanning are rejected.
- No per-request package installation, project directories, build scripts, or artifact storage.
- HTTP statuses: 200 success, 400 invalid input, 413 request too large,
  422 compilation failure, 500 unexpected service failure.
- Diagnostics use one-based lines and columns when a project location is available.
  Runtime errors are not mapped back to TSX; full TypeScript type checking is not included.

Tailwind scans the submitted source text and the built-in component sources.
Use complete class names, not expressions such as bg-${color}-500. Custom CSS
and theme variables are supported. CSS and JavaScript are returned together;
loading JavaScript alone is insufficient.

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
permission. It owns its DOM, CSS, and React instance. The host sends compiled
contents to the frame; the frame loads a local Blob and reports lifecycle errors
through source-checked window messages. A transferred MessagePort proxies local
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
   verify the modified files return while the conversation is empty.
10. Return to the gallery, reopen the project, then create another from the same
    template. Verify the original project and the template are unchanged.
11. Create Blank and Product showcase projects; check Hello and the expandable FAQ.

GET /api/health remains a diagnostic endpoint; the UI does not poll it.
Unknown /api routes return JSON 404. Unknown application routes show a not-found
page; missing static assets return HTTP 404.

## Next iterations

1. Scene JSON-to-TSX compilation and independently compiled entries, after separate design review.
2. Export and deployment capabilities, after separate design review.
