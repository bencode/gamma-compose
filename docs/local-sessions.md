# Local chat sessions

Gamma Compose keeps chat state in the browser. The model proxy remains stateless and
receives only the transcript needed for the current provider request.

## Storage model

IndexedDB version 4 adds two stores:

```ts
type ChatSessionMetadata = {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

type ChatTranscriptRecord = {
  sessionId: string
  messages: AgentMessage[]
}
```

`sessions` is indexed by `projectId`; `sessionTranscripts` keeps the larger message
payload separate from the lightweight chat list. Version 4 migrates any legacy
session record with embedded `messages` into this pair without changing its ID.

Chats belong to one project. They share that project's latest files, preview build,
attachments, and application database. Selecting a chat restores conversation context,
not an older project snapshot. Deleting a chat leaves project state unchanged. Deleting
a project removes both chat stores together with the project's other local state.

## Runtime lifecycle

On workbench load, the browser selects the chat with the newest `lastOpenedAt`. If none
exists, it creates an in-memory `New chat`; the record is written only when the first
message is sent. An explicit New chat is written immediately. The first user message
becomes a whitespace-normalized title capped at 60 Unicode code points.

Pi is created with the saved `sessionId` and `initialState.messages`. This restores the
normal multi-turn transcript. Reopening does not call Pi `continue()`: that method is
for continuing an interrupted user or tool-result turn, not for starting the next
ordinary user request.

Each Pi `message_end` writes the complete current transcript and metadata in one
IndexedDB transaction. A save failure is visible, aborts the active Agent run, preserves
the newest in-memory transcript, and blocks more messages or chat changes until Retry
saves that snapshot. Unknown storage failures are logged rather than hidden.

## Deliberate limits

This iteration does not migrate to Pi `AgentHarness`. Its durable-operation resume model
has no supplied IndexedDB backend, and in-flight browser recovery would add a separate
operation log and recovery policy. The current contract restores completed transcripts
only. Draft persistence, chat URLs, branching, compaction, export, and cross-tab
coordination are also out of scope.
