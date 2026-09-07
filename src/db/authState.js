/**
 * MongoDB-backed AuthenticationState for Baileys
 * Compatible with @whiskeysockets/baileys AuthenticationState interface
 */
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'
import AuthState from './models/AuthState.js'
import logger from '../utils/logger.js'

/**
 * Create or restore auth state for a session from MongoDB
 */
export async function useMongoAuthState(sessionId) {
  let doc = await AuthState.findOne({ sessionId }).lean()

  let creds
  let keys = {}

  if (doc && doc.creds) {
    // Restore with BufferJSON.reviver
    creds = JSON.parse(JSON.stringify(doc.creds), BufferJSON.reviver)
    keys = doc.keys || {}
  } else {
    creds = initAuthCreds()
    // Persist immediately
    await AuthState.findOneAndUpdate(
      { sessionId },
      { sessionId, creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)), keys: {} },
      { upsert: true, new: true }
    )
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
            if (value) {
              keys[category][id] = value
            } else {
              delete keys[category][id]
            }
          }
        }
        // Persist keys (non-blocking best-effort)
        AuthState.findOneAndUpdate(
          { sessionId },
          { keys: JSON.parse(JSON.stringify(keys, BufferJSON.replacer)) },
          { upsert: true }
        ).catch((err) => {
          logger.error({ sessionId, err: err.message }, 'Failed to save auth keys')
        })
      },
    },
  }

  const saveCreds = async () => {
    try {
      await AuthState.findOneAndUpdate(
        { sessionId },
        {
          creds: JSON.parse(JSON.stringify(state.creds, BufferJSON.replacer)),
          keys: JSON.parse(JSON.stringify(keys, BufferJSON.replacer)),
        },
        { upsert: true }
      )
    } catch (err) {
      logger.error({ sessionId, err: err.message }, 'Failed to save creds')
    }
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
