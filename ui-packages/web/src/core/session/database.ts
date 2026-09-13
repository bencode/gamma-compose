import type { Project } from '../project/records'
import {
  type ChatSession,
  type ChatSessionMetadata,
  type ChatTranscriptRecord,
  chatSessionMetadata,
  emptyChatSession,
  sortChatSessions,
} from './records'

const transactionCompleted = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Database transaction aborted.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Database transaction failed.'))
  })

const projectExists = async (db: IDBDatabase, projectId: string) => {
  const transaction = db.transaction('projects', 'readonly')
  const request = transaction.objectStore('projects').get(projectId)
  await transactionCompleted(transaction)
  return Boolean(request.result as Project | undefined)
}

export const createChatDatabase = (db: IDBDatabase) => {
  const getChatSession = async (
    projectId: string,
    sessionId: string,
  ): Promise<ChatSession | undefined> => {
    const transaction = db.transaction(['sessions', 'sessionTranscripts'], 'readonly')
    const metadataRequest = transaction.objectStore('sessions').get(sessionId)
    const transcriptRequest = transaction.objectStore('sessionTranscripts').get(sessionId)
    await transactionCompleted(transaction)
    const metadata = metadataRequest.result as ChatSessionMetadata | undefined
    const transcript = transcriptRequest.result as ChatTranscriptRecord | undefined
    if (!metadata || metadata.projectId !== projectId) return undefined
    return { ...metadata, messages: transcript?.messages ?? [] }
  }

  const listChatSessions = async (projectId: string): Promise<ChatSessionMetadata[]> => {
    const transaction = db.transaction('sessions', 'readonly')
    const request = transaction.objectStore('sessions').index('projectId').getAll(projectId)
    await transactionCompleted(transaction)
    return sortChatSessions(request.result as ChatSessionMetadata[])
  }

  const createChatSession = async (projectId: string, id?: string): Promise<ChatSession> => {
    if (!(await projectExists(db, projectId))) throw new Error('Project not found.')
    const session = emptyChatSession(projectId, id)
    const transaction = db.transaction(['sessions', 'sessionTranscripts'], 'readwrite')
    transaction.objectStore('sessions').add(chatSessionMetadata(session))
    transaction
      .objectStore('sessionTranscripts')
      .add({ sessionId: session.id, messages: session.messages } satisfies ChatTranscriptRecord)
    await transactionCompleted(transaction)
    return session
  }

  const saveChatSession = async (session: ChatSession): Promise<void> => {
    if (!(await getChatSession(session.projectId, session.id))) throw new Error('Chat not found.')
    const transaction = db.transaction(['sessions', 'sessionTranscripts'], 'readwrite')
    transaction.objectStore('sessions').put(chatSessionMetadata(session))
    transaction
      .objectStore('sessionTranscripts')
      .put({ sessionId: session.id, messages: session.messages } satisfies ChatTranscriptRecord)
    await transactionCompleted(transaction)
  }

  const deleteChatSession = async (projectId: string, sessionId: string): Promise<void> => {
    if (!(await getChatSession(projectId, sessionId))) throw new Error('Chat not found.')
    const transaction = db.transaction(['sessions', 'sessionTranscripts'], 'readwrite')
    transaction.objectStore('sessions').delete(sessionId)
    transaction.objectStore('sessionTranscripts').delete(sessionId)
    await transactionCompleted(transaction)
  }

  return { getChatSession, listChatSessions, createChatSession, saveChatSession, deleteChatSession }
}

export const deleteProjectChats = (transaction: IDBTransaction, projectId: string) => {
  const request = transaction.objectStore('sessions').index('projectId').getAll(projectId)
  request.onsuccess = () => {
    const sessions = request.result as ChatSessionMetadata[]
    sessions.forEach(session => {
      transaction.objectStore('sessions').delete(session.id)
      transaction.objectStore('sessionTranscripts').delete(session.id)
    })
  }
}
