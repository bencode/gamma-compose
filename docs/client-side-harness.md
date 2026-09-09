# Client-Side Harness

## Intent

Gamma Compose is an embeddable, browser-first environment for building React interfaces with an Agent.

The harness runs on the client: it owns the Agent loop, conversation context, project state, and tool execution. Model inference remains with external model providers. Running models locally or hosting inference ourselves is not a goal.

## Responsibility Boundary

- **Client:** Agent orchestration, workspace management, local file processing, tool execution, and project-scoped IndexedDB access.
- **Model gateway:** request forwarding, browser cross-origin access, usage accounting, and billing.
- **Compiler:** stateless compilation of submitted source files.
- **Model provider:** model inference.

The server does not own the harness session or workspace. Statelessness applies to Agent execution and compilation; accounting and billing may retain their necessary records.

## Why the Browser

A browser-based harness lowers the adoption barrier compared with a desktop application and brings tools to the user's data.

For large PDFs and other documents, client-side tools can inspect, search, and extract relevant content without uploading the original file to our servers. Selected content then enters subsequent model requests as tool results.

This is data minimization, not a promise that no data leaves the device:

- Original documents can remain local.
- Selected content is sent to the model provider and is visible to our gateway when proxied.
- React compilation currently sends project source files to our compiler.
- Provider trust depends on the chosen service and its data policies.

## Near-Term Focus

First, establish the React workflow: request → file changes → compilation → preview → correction.

Generated applications can use `@gamma-compose/local-db` through an iframe-to-host
MessagePort bridge. The sandbox keeps its opaque origin; the host owns schema
validation and IndexedDB. Agent database tools use the same project-scoped data.
Compilation remains stateless and does not receive database records.

The preview reports bounded, current-build runtime diagnostics back to the host.
The Agent can explicitly read errors and console output when the user reports broken
behavior, then repair, compile, and refresh through the existing orthogonal tools.
Diagnostics do not trigger model inference automatically, grant the iframe broader
permissions, inspect the DOM, or simulate user interaction.

PDF processing and other local-data tools are future applications of the same client-side harness model, not requirements for the current iteration.
