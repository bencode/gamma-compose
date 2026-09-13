import { type ChatSession, type ChatTranscriptRecord, chatSessionMetadata } from './records'

export const configureSessionStores = (db: IDBDatabase, transaction: IDBTransaction) => {
  const sessions = db.objectStoreNames.contains('sessions')
    ? transaction.objectStore('sessions')
    : db.createObjectStore('sessions', { keyPath: 'id' })
  if (!sessions.indexNames.contains('projectId')) sessions.createIndex('projectId', 'projectId')
  const transcripts = db.objectStoreNames.contains('sessionTranscripts')
    ? transaction.objectStore('sessionTranscripts')
    : db.createObjectStore('sessionTranscripts', { keyPath: 'sessionId' })
  const cursorRequest = sessions.openCursor()
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result
    if (!cursor) return
    const legacy = cursor.value as ChatSession
    if (Array.isArray(legacy.messages)) {
      transcripts.put({
        sessionId: legacy.id,
        messages: legacy.messages,
      } satisfies ChatTranscriptRecord)
      cursor.update(chatSessionMetadata(legacy))
    }
    cursor.continue()
  }
}
