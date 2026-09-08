import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'
import AuthState from './models/AuthState.js'
import logger from '../utils/logger.js'

export async function useMongoAuthState(sessionId) {
  const doc = await AuthState.findOne({ sessionId }).lean()

  let creds
  let keys = {}

  if (doc && doc.creds) {
    creds = JSON.parse(JSON.stringify(doc.creds), BufferJSON.reviver)
    keys = doc.keys ? JSON.parse(JSON.stringify(doc.keys), BufferJSON.reviver) : {}
  } else {
    creds = initAuthCreds()
    await AuthState.findOneAndUpdate(
      { sessionId },
      { sessionId, creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)), keys: {} },
      { upsert: true, new: true }
    )
  }

  let pendingFlush = null

  const flush = () => {
    if (pendingFlush) return pendingFlush
    pendingFlush = new Promise((resolve) => {
      setImmediate(async () => {
        const snapshot = {
          creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
          keys: JSON.parse(JSON.stringify(keys, BufferJSON.replacer)),
        }
        try {
          await AuthState.findOneAndUpdate({ sessionId }, snapshot, { upsert: true })
        } catch (err) {
          logger.error({ sessionId, err: err.message }, 'Failed to persist auth state')
        } finally {
          pendingFlush = null
          resolve()
        }
      })
    })
    return pendingFlush
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {}
        for (const id of ids) {
          let value = keys?.[type]?.[id]
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value)
          }
          if (value) data[id] = value
        }
        return data
      },
      set: async (data) => {
        for (const category in data) {
          if (!keys[category]) keys[category] = {}
          for (const id in data[category]) {
            const value = data[category][id]
            if (value) keys[category][id] = value
            else delete keys[category][id]
          }
        }
        await flush()
      },
    },
  }

  const saveCreds = async () => {
    await flush()
  }

  const clearAuth = async () => {
    try {
      await AuthState.deleteOne({ sessionId })
      keys = {}
    } catch (err) {
      logger.error({ sessionId, err: err.message }, 'Failed to clear auth')
    }
  }

  return { state, saveCreds, clearAuth }
}

export default useMongoAuthState
