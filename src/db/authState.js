import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'
import AuthState from './models/AuthState.js'
import logger from '../utils/logger.js'

/**
 * Mongo-backed Baileys auth state with debounced writes.
 * Key reads are pure memory. Writes batch into a single flush so
 * high-frequency Signal key updates never serialize the message path.
 */
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

  let flushTimer = null
  let flushPromise = null
  let dirty = false

  const doFlush = async () => {
    if (!dirty) return
    dirty = false
    const snapshot = {
      creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      keys: JSON.parse(JSON.stringify(keys, BufferJSON.replacer)),
    }
    try {
      await AuthState.findOneAndUpdate({ sessionId }, snapshot, { upsert: true })
    } catch (err) {
      logger.error({ sessionId, err: err.message }, 'Failed to persist auth state')
      dirty = true // retry later
    }
  }

  const scheduleFlush = (delayMs = 80) => {
    dirty = true
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushPromise = doFlush().finally(() => {
        flushPromise = null
        // if more writes arrived during flush, schedule again
        if (dirty) scheduleFlush(40)
      })
    }, delayMs)
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {}
        const bucket = keys?.[type]
        if (!bucket) return data
        for (const id of ids) {
          let value = bucket[id]
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
        // Do NOT await Mongo here — return immediately so Signal pipeline stays free
        scheduleFlush(80)
      },
    },
  }

  const saveCreds = async (opts = {}) => {
    // Hot path (creds.update): debounce only — never block Signal pipeline
    if (!opts?.flush) {
      scheduleFlush(60)
      return
    }
    // Explicit flush (logout / stop): drain pending write
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    dirty = true
    await doFlush()
  }

  const clearAuth = async () => {
    try {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      dirty = false
      await AuthState.deleteOne({ sessionId })
      keys = {}
    } catch (err) {
      logger.error({ sessionId, err: err.message }, 'Failed to clear auth')
    }
  }

  return { state, saveCreds, clearAuth }
}

export default useMongoAuthState
