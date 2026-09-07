# Agent project tools

Iteration 3B connects the browser Pi Agent to the current React project. The Agent
loop, conversation, tools and project state run in the browser. The server retains
its existing stateless model proxy and compilation endpoints.

## Project ownership

`features/projects/project-page.tsx` loads a project by URL ID from IndexedDB and
creates one `ProjectStore` before mounting the workbench. Both the file browser
and Agent tools use this store. Writes publish immutable snapshots; React subscribes
through `useSyncExternalStore`. Template entries remain `src/main.tsx`.
The store survives tab changes and responsive panel remounts. On refresh, a new
store is created from the last saved snapshot, with a new conversation and preview.

`core/project/database.ts` owns the native IndexedDB `gamma-compose` database,
version 1. The `templates` and `projects` stores use `id` as their key. Three
templates are inserted during initial database creation, never on normal reopening.
Creating a project copies the selected template's files into an independent UUID
record with a name and `updatedAt`. Opening an existing project never copies a template.

The project page subscribes to valid file changes and immediately submits a whole
snapshot transaction. Transactions complete in submission order; no debounce or
additional mutation queue is used. Only completion for the current snapshot reports
Saved. Save failures are logged and displayed with Retry save, while the in-memory
files remain available. File tool success confirms the in-memory change, not storage
durability. There is no unload-time flush guarantee: only committed data survives.
Read failures and missing project IDs do not silently create replacement projects.
Closing the workbench stops the Agent and compilation; chat and drafts are not saved.

Before publishing, the store validates canonical relative paths, file/directory
collisions, the 128-file limit and the 2 MiB serialized UTF-8 compile request limit.
Rejected writes keep the previous snapshot. An edit containing several replacements
publishes once after Pi has validated all replacements. Stop does not undo writes.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `list` | `{ path?: string }` | Sorted project-relative file paths, one per line |
| `read` | `{ path: string, offset?: number, limit?: number }` | Text, with Pi's range and truncation guidance |
| `edit` | `{ path: string, edits: { oldText: string, newText: string }[] }` | Pi's replacement confirmation |
| `write` | `{ path: string, content: string }` | Pi's create/overwrite confirmation |
| `compile` | `{}` | Compilation confirmation and warnings, or error diagnostics |

`list` recursively lists every file by default, without reading content. `path`
restricts it to a directory. Its output is a flat list, not an ASCII tree; the file
panel independently renders a tree. Missing directories and file arguments fail.

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

The UI shows tool names, target paths and execution status. It does not render
file contents, write arguments or edit diffs in the conversation. File contents
returned by tools are visible to the model provider through the existing proxy.
Tool arguments are untrusted model output. The conversation reads path labels only
from non-null, non-array objects and leaves the original arguments unchanged for
Pi validation. Invalid arguments produce tool errors without blocking later calls
or messages. End-of-run cleanup restores sending before refreshing the snapshot;
snapshot failures are reported visibly rather than silently discarded.

## Compilation flow

```text
User request -> Pi file tools -> current project snapshot
                               -> explicit compile tool
                                  -> POST /api/compile
                                     -> failure: Pi tool error -> model repair
                                     -> success: new preview iframe + model confirmation
```

`core/agent/system-prompt.ts` describes the entry, supported package imports,
built-in component composition and the read/edit/compile workflow. It does not
duplicate source files in every model request. The model discovers files with tools.

`usePreview` automatically compiles the loaded project. Later file changes do not
trigger compilation. Its stable `compile(signal?)` command reads the latest store
snapshot; the Agent and manual Retry use the same command. Retry is disabled during
an Agent run. Every successful build gets a new iframe key, so React batching cannot
leave a previously loaded module in place.

Compile failure throws a model-visible error containing `phase: "compile"` and
the existing diagnostics (`message`, optional `path`, one-based `line` and `column`).
Pi records it as `isError: true` and continues the model/tool loop. Network,
protocol and HTTP 5xx failures instead use `phase: "service"`; the client throws
an error containing the HTTP status for 5xx responses, even when their body matches
the compile result schema. HTTP 422 remains a compile diagnostic; HTTP 400 and 413
retain their input-error diagnostics. The prompt tells the model not to treat
service failures as broken source. Diagnostic text is capped at 50 KiB with an explicit
truncation notice. The preview retains the complete compiler diagnostics.

Success returns only `compiled: true`, `previewRefreshRequested: true`, and
`warnings`. JavaScript and CSS go only to the preview, never to tool content or
details. The tool does not wait for iframe lifecycle messages. Compilation does not
include full TypeScript checking, runtime observation or interaction testing.

Cancellation reaches the compilation fetch, displays `Compilation cancelled.`, and
allows a later Retry. Cancelled or superseded requests cannot publish late results.
The existing iframe error channel remains UI-only. There is no automatic repair
budget in this iteration; the user can Stop the Agent.

The compiler additionally allows `react-router-dom` from its installed dependencies.
Preview routes use MemoryRouter, independently of the host BrowserRouter. The bundle
still contains a single entry and its dependencies; external modules and iframe
permissions are unchanged. Gallery thumbnails are static screenshots of the templates,
not live compiler requests for every card.

## Verification

Tests execute the actual Pi file tools against the browser adapter, cover rejected
writes and partial-edit safety, and simulate a model making an invalid edit,
receiving a compile error, repairing it and compiling successfully. UI tests cover
file synchronization, explicit compilation, frame reloads, cancellation, tool
activity, and existing conversation continuity.

Run `pnpm check` and `pnpm build`. With a configured provider, ask for a real page
change, inspect the changed source, and test the resulting preview in the browser.
This external acceptance test is not an Agent runtime-observation capability.

Search, source diff UI, chat persistence, deletion/rename, shell commands, package
installation, runtime feedback and multiple compilation entries remain out of scope.
