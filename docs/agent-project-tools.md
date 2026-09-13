# Agent project tools

The browser project integration connects Pi to the current React project. The Agent
loop, conversation, tools and project state run in the browser. The server retains
its existing stateless model proxy and compilation endpoints.

## Project ownership

`features/projects/project-page.tsx` loads a project by URL ID from IndexedDB and
creates one `ProjectStore` before mounting the workbench. Both the file browser
and Agent tools use this store. Writes publish immutable snapshots; React subscribes
through `useSyncExternalStore`. Template entries remain `src/main.tsx`.
The store survives tab changes and responsive panel remounts. On refresh, a new
store is created from the last saved snapshot and the latest chat transcript is restored.

`core/project/database.ts` owns the native IndexedDB `gamma-compose` database,
version 4. The `templates`, `projects`, `compileStates`, `files`, `contents`,
`sessions`, and `sessionTranscripts` stores keep projects, compiled-tree metadata,
local repository files, chat metadata, and complete Pi transcripts. Three
templates are inserted during initial database creation, never on normal reopening.
Creating a project copies the selected template's files into an independent UUID
record with a name and `updatedAt`. Opening an existing project never copies a template.
Deleting a project from the gallery removes its source record, compiled-tree metadata,
repository metadata and shared Blob contents in one project-database transaction. It
also deletes the project's separate local application database. Server-side compiled
artifacts are derived data and remain subject to server retention rather than browser
deletion.

The project page subscribes to valid file changes and immediately submits a whole
snapshot transaction. Transactions complete in submission order; no debounce or
additional mutation queue is used. Only completion for the current snapshot reports
Saved. Save failures are logged and displayed with Retry save, while the in-memory
files remain available. File tool success confirms the in-memory change, not storage
durability. There is no unload-time flush guarantee: only committed data survives.
Read failures and missing project IDs do not silently create replacement projects.
Completed Pi messages are saved after each `message_end`. Closing the workbench stops
the Agent and compilation; the latest committed transcript returns on reopen. Drafts
and currently selected attachments are not saved.

Before publishing, the store validates canonical relative paths, file/directory
collisions, the 1,024-file limit and the 16 MiB serialized UTF-8 project limit.
Rejected writes keep the previous snapshot. An edit containing several replacements
publishes once after Pi has validated all replacements. Stop does not undo writes.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `list` | `{ path?: string }` | Sorted project-relative file paths, one per line |
| `read` | `{ path: string, offset?: number, limit?: number }` | Text, with Pi's range and truncation guidance |
| `copy` | `{ source: string, destination: string, overwrite?: boolean }` | Copy one file while preserving its source |
| `edit` | `{ path: string, edits: { oldText: string, newText: string }[] }` | Pi's replacement confirmation |
| `write` | `{ path: string, content: string }` | Pi's create/overwrite confirmation |
| `analyze_image` | `{ path: string, question?: string }` | Stable image-analysis contract; analysis is not implemented yet |
| `db_get` | `{ resource: string, id: string }` | One record or `null` |
| `db_list` | `{ resource: string, query?: ListQuery }` | A page of records |
| `db_create` | `{ resource: string, data: object }` | The committed record or a bounded commit summary |
| `db_update` | `{ resource: string, id: string, changes: object }` | The committed record or a bounded commit summary |
| `db_remove` | `{ resource: string, id: string }` | Removal confirmation |
| `compile` | `{}` | Compilation confirmation and warnings, or error diagnostics |
| `refresh_preview` | `{}` | Confirmation after the new iframe reports that its module loaded |
| `read_preview_errors` | `{}` | Current build status and captured load/runtime errors |
| `read_preview_console` | `{}` | Captured console output for the current build |

`list` recursively lists every file by default, without reading content. `path`
restricts it to a directory. Its output is a flat list, not an ASCII tree; the file
panel independently renders a tree. Missing directories and file arguments fail.

Uploaded Markdown and images live under `attachments/`. `copy` promotes a selected
image to `src/assets/` without removing the reference attachment. Image copies have
independent file metadata but share one IndexedDB Blob through `contentId`; legacy
metadata falls back to `id`. `overwrite` defaults to false and must be explicit.
Blob content is deleted only after its final metadata reference is removed.

`read`, `edit` and `write` reuse factories from the pinned Pi core 0.84.4 package.
The binding retains their schemas, argument preparation, truncation and replacement
semantics. Read offsets are one-based; text output is capped at 2,000 lines or
50 KiB. A single oversized line is omitted with a browser-appropriate explanation,
not Pi's shell suggestion. Edit matches are against the original file, including
Pi's normalization/fuzzy matching, and must be unique and non-overlapping.

`core/agent/project-env.ts` adapts Pi's execution environment to text files under
virtual `/project`. It implements path resolution, existence, canonical paths,
metadata, text reads, UTF-8 byte reads and text writes. Absolute paths outside that
root and parent traversal are rejected. Directories are derived from file paths;
there are no symlinks. Unsupported filesystem operations return `not_supported`;
shell execution returns `shell_unavailable`. No tool accesses the host filesystem.
Pi's native per-file mutation queue is retained, and tools execute sequentially.

The local database skill is available to Pi as the read-only virtual file
`/project/.gamma/skills/local-db/SKILL.md`. It is included in the system prompt as
a Pi skill, but it is not project source, does not appear in `list`, and cannot be
overwritten by file tools. The skill documents resource files, application calls,
Agent database tools, and the compile/refresh workflow.

Database tools load direct `data/*.resource.json` files from the latest project
snapshot for every operation. They pass `project:<projectId>` to the native package,
which opens `gamma-compose:local-db:project:<projectId>`. Each tool executes one
operation and closes its handle. The generated application
uses the logical database name `app`; the host maps it to the same physical project
database. Thus the Agent and preview share records without exposing another
project's namespace. Tool results are capped at 50 KiB. Oversized reads fail with
guidance to narrow the query; an oversized successful create or update returns a
small `{ committed: true, id, recordOmitted }` result so the committed write is not
misreported as a failure.

The UI groups Pi thinking and tool calls into disclosures. A live trailing group
shows its step rows and folds after completion. Expanding a tool step reveals its
input and text output as bounded preformatted text, not Markdown. File contents
returned by tools are also visible to the model provider through the existing
proxy. Tool arguments are untrusted model output. The conversation reads path
labels only from non-null, non-array objects and leaves the original arguments
unchanged for Pi validation. Invalid arguments produce tool errors without
blocking later calls or messages. End-of-run cleanup restores sending before
refreshing the snapshot; snapshot failures are reported visibly rather than
silently discarded.

## Compilation flow

```text
User request -> Pi file tools -> current project snapshot
                               -> explicit compile tool
                                  -> POST /api/compiler/projects/:projectId/builds
                                     with a complete hash tree and required source text
                                     -> failure: Pi tool error -> model repair
                                     -> success: publish immutable static revision
                                        -> explicit refresh_preview
                                           -> iframe loads previewUrl and reports preview:loaded

User request -> Pi database tools -> host-owned project IndexedDB
                                  -> explicit refresh_preview using current artifact

User reports broken behavior -> read_preview_errors + read_preview_console
                             -> repair source -> compile -> refresh_preview
```

`core/agent/system-prompt.ts` describes the entry, supported package imports,
built-in component composition and the read/edit/compile workflow. It does not
duplicate source files in every model request. The model discovers files with tools.

`usePreview` automatically compiles and refreshes the loaded project. Later file
changes do not trigger either action. Its stable `compile(signal?)` command reads
the latest store and repository snapshots and caches the successful artifact without
replacing the iframe. `refresh(signal?)` requires that artifact to match both snapshots,
creates a new iframe key, and resolves only after the source-checked
`preview:loaded` message followed by a one-second initialization stability window.
A load or runtime error during that window rejects the refresh and returns to Pi as
a tool error. Manual Retry composes compile and refresh; Retry is disabled during
an Agent run. Refresh has a 15-second module-loading timeout.

Compile failure throws a model-visible error containing `phase: "compile"` and
the existing diagnostics (`message`, optional `path`, one-based `line` and `column`).
Pi records it as `isError: true` and continues the model/tool loop. Network,
protocol and HTTP 5xx failures instead use `phase: "service"`; the client throws
an error containing the HTTP status for 5xx responses, even when their body matches
the compile result schema. HTTP 422 remains a compile diagnostic; HTTP 400 and 413
retain their input-error diagnostics. The prompt tells the model not to treat
service failures as broken source. Diagnostic text is capped at 50 KiB with an explicit
truncation notice. The preview retains the complete compiler diagnostics.

Compile success returns only `compiled: true`, `refreshRequired: true`, and
`warnings`. The build URL remains in preview state and never enters tool content or
details. `refresh_preview` returns `{ refreshed: true, buildId }` after module load.
It may also be called after database-only changes because no source compilation is
needed. A successful result also means no reported error occurred during the
one-second initialization window. It does not provide full TypeScript checking,
DOM inspection, or interaction testing.

Each refresh starts a new host-owned diagnostics buffer for that build. The iframe
forwards `console.debug`, `console.log`, `console.info`, `console.warn`, and
`console.error`, plus uncaught window errors, unhandled promise rejections, module
load failures, and Content Security Policy violations. A document-level submit
guard prevents unhandled native form navigation and reports an actionable runtime
error; application handlers that synchronously call `preventDefault()` remain
valid. This keeps `sandbox="allow-scripts"` and the existing CSP intact instead of
granting form or origin permissions.

`read_preview_errors` returns `{ buildId, status, errors, dropped }`, where status
is `not-loaded`, `loading`, `ready`, or `failed`. `read_preview_console` returns
`{ buildId, entries, dropped }`. Error and console records have a shared monotonic
sequence number, timestamp, and structured source or level. They are separate,
read-only tools: neither compiles, refreshes, edits files, nor starts another model
turn. Buffers retain only the current build, cap each channel at 100 records and
40 KiB, and report discarded records through `dropped`.

Fatal load/runtime errors continue to drive the existing preview overlay and reject
an in-progress refresh. CSP reports are diagnostic but nonfatal. Browser-internal
DevTools messages are not assumed to be observable; explicit iframe instrumentation
covers the supported classes above. The system prompt tells the Agent to call both
diagnostic tools when the user reports an error, inert control, or unexpected
behavior before editing. If the result is insufficient, the Agent may add focused
console output, ask the user to reproduce once, read the next build's output, and
remove temporary logging after the repair. Empty buffers are not proof that an
interaction works.

Cancellation reaches the compilation fetch, displays `Compilation cancelled.`, and
allows a later Retry. Cancelled or superseded requests cannot publish late results.
There is no automatic repair turn or budget in this iteration; the user initiates
the diagnostic loop through a normal conversation message and can Stop the Agent.

The compiler additionally allows `react-router-dom` and `@gamma-compose/local-db`
from its installed dependencies. The local database import maps to a small sandbox
client in the shared runtime; IndexedDB and Ajv are not executed by the opaque-origin
iframe. Instead, a transferred `MessagePort` carries typed CRUD requests to a
host-owned bridge. The iframe retains `sandbox="allow-scripts"` and the existing CSP.
Preview routes use MemoryRouter, independently of the host BrowserRouter. Gallery
thumbnails are static screenshots of the templates, not live compiler requests for
every card.

PNG, JPEG, WebP, and GIF files under `src/assets/` are compiler inputs by descriptor
only. A normal source import such as `import heroUrl from './assets/hero.png'` resolves
to a generated ESM wrapper. That wrapper uses top-level await to request the Blob from
an independent local-asset `MessagePort`, creates an iframe-owned object URL, and
default-exports the URL string. The host accepts only paths and hashes declared by the
current successful build. Repeated imports reuse the module result, lazy modules load
their images on demand, and iframe teardown revokes created URLs. Image bytes travel
from host IndexedDB to the opaque-origin iframe and never enter the compilation request
or server storage. CSS `url(...)`, SVG, and arbitrary binary assets remain unsupported.

The browser owns the source tree and stores its last successful compiled tree in the
project database. The initial compile sends every text source plus descriptors for
local images. Later builds send the complete path/hash/byte manifest tree and normally
send text only for changed or new files. Image contents are never sent. When source
paths are added or deleted, the browser also sends every
non-CSS module so extensionless imports can be resolved again. Absence from the tree
represents deletion. A 409 causes one harness-owned tree read, diff, and retry. The
Agent never manages hashes or synchronization.

The server keeps no source session. It publishes rebuildable immutable output under
`GAMMA_DATA_DIR` (default `.gamma-data`): an HTML entry, one ESM output for every
declared module or local-image wrapper, independent CSS artifacts, and final Tailwind CSS. Unchanged artifacts
are hard-linked from the current build. Local import specifiers remain intact and the
static route resolves extensionless, exact-extension, JSON, and index imports to one
canonical output URL. React, React DOM, React Router, built-in UI, and the preview
database client share a precompiled import-map runtime. Literal `React.lazy` imports
remain dynamic; computed import paths are rejected. Static responses include the CORS
and cross-origin resource headers required by the iframe's opaque origin.

## Verification

Tests execute the actual Pi file and database tools against the browser adapters,
cover validation, project isolation, bounded results, rejected writes and partial-edit
safety, and simulate a model repairing a compile error before explicitly refreshing.
UI tests cover file synchronization, the compile/refresh boundary, iframe reloads,
cancellation, tool activity, and existing conversation continuity. Bridge tests run
the preview client and host across a real `MessageChannel` backed by fake IndexedDB.

Run `pnpm check` and `pnpm build`. With a configured provider, ask for a real page
change, inspect the changed source, and test the resulting preview in the browser.
This external acceptance test is not an Agent runtime-observation capability.

Search, source diff UI, chat branching, project rename, shell commands, package
installation, DOM inspection, automated interaction testing, a visible Console/Errors
panel, and multiple compilation entries remain out of scope.
