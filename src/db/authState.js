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
  // Serialize writes so concurrent key updates can't race each other,
  // and so callers can truly await persistence completing.
  let writeQueue = Promise.resolve()

  if (doc && doc.creds) {
    // Restore with BufferJSON.reviver — MUST also revive `keys`, not just
    // `creds`. Signal key material (Buffers) is stored in Mongo as
    // {type:'Buffer', data:[...]} via BufferJSON.replacer; loading it back
    // without the reviver leaves plain objects instead of real Buffers,
    // which corrupts every crypto op downstream and shows up as
    // "Bad MAC Error" / "MessageCounterError: Key used already or never
    // filled" the next time this session decrypts a message.
    creds = JSON.parse(JSON.stringify(doc.creds), BufferJSON.reviver)
    keys = doc.keys ? JSON.parse(JSON.stringify(doc.keys), BufferJSON.reviver) : {}
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
        // IMPORTANT: this must be awaited before returning. Baileys advances
        // the signal-protocol ratchet on every message and relies on this
        // resolving only once the new key state is durably saved — otherwise
        // a process restart right after a message can load stale keys while
        // WhatsApp has already moved the counter forward, causing
        // "MessageCounterError: Key used already or never filled".
        const snapshot = JSON.parse(JSON.stringify(keys, BufferJSON.replacer))
        writeQueue = writeQueue.then(() =>
          AuthState.findOneAndUpdate({ sessionId }, { keys: snapshot }, { upsert: true }).catch(
            (err) => {
              logger.error({ sessionId, err: err.message }, 'Failed to save auth keys')
            }
          )
        )
        await writeQueue
      },
    },
  }

  const saveCreds = async () => {
    try {
      // Make sure any in-flight key writes land before we also persist creds,
      // so a save always reflects a consistent creds+keys snapshot.
      await writeQueue
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
      await writeQueue
      await AuthState.deleteOne({ sessionId })
      keys = {}
    } catch (err) {
      logger.error({ sessionId, err: err.message }, 'Failed to clear auth')
    }
  }

  return { state, saveCreds, clearAuth }
}

export default useMongoAuthState
