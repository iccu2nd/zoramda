import { jidNormalizedUser } from '@whiskeysockets/baileys';

/**
 * Soft-TTL group metadata cache.
 * Stale-while-revalidate: never block command path on sock.groupMetadata()
 * after the first successful fetch for a group.
 */

const groupMetadataCache = new Map();
const groupParticipantIndexCache = new Map();
const groupMetaFetchedAt = new Map();
const groupMetaRefreshing = new Set();
const groupEphemeralCache = new Map();

const GROUP_META_SOFT_TTL_MS = Number(process.env.GROUP_META_SOFT_TTL_MS || 5 * 60_000);

function buildParticipantIndex(metadata) {
  const index = new Map();
  for (const p of metadata?.participants || []) {
    if (p.id) index.set(jidNormalizedUser(p.id), p);
    if (p.phoneNumber) index.set(jidNormalizedUser(p.phoneNumber), p);
  }
  return index;
}

function storeGroupMeta(jid, meta) {
  groupMetadataCache.set(jid, meta);
  groupParticipantIndexCache.set(jid, buildParticipantIndex(meta));
  groupMetaFetchedAt.set(jid, Date.now());
}

async function refreshGroupMetadata(sock, jid) {
  if (groupMetaRefreshing.has(jid)) return;
  groupMetaRefreshing.add(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    if (meta) storeGroupMeta(jid, meta);
  } catch {
    // keep stale
  } finally {
    groupMetaRefreshing.delete(jid);
  }
}

export async function getCachedGroupMetadata(sock, jid) {
  const cached = groupMetadataCache.get(jid);
  if (cached) {
    const fetchedAt = groupMetaFetchedAt.get(jid) || 0;
    if (Date.now() - fetchedAt > GROUP_META_SOFT_TTL_MS) {
      setImmediate(() => {
        refreshGroupMetadata(sock, jid).catch(() => {});
      });
    }
    return cached;
  }
  try {
    const meta = await sock.groupMetadata(jid);
    if (meta) storeGroupMeta(jid, meta);
    return meta;
  } catch {
    return null;
  }
}

export function setCachedGroupMetadata(jid, meta) {
  if (!meta) return;
  storeGroupMeta(jid, meta);
}

export function getCachedParticipantIndex(jid) {
  return groupParticipantIndexCache.get(jid) || new Map();
}

export function setGroupEphemeral(jid, expiration) {
  if (jid && expiration) groupEphemeralCache.set(jid, expiration);
}

export function getGroupEphemeral(jid) {
  return groupEphemeralCache.get(jid) || null;
}

export function clearGroupCache(jid) {
  if (!jid) {
    groupMetadataCache.clear();
    groupParticipantIndexCache.clear();
    groupMetaFetchedAt.clear();
    groupEphemeralCache.clear();
    return;
  }
  groupMetadataCache.delete(jid);
  groupParticipantIndexCache.delete(jid);
  groupMetaFetchedAt.delete(jid);
  groupEphemeralCache.delete(jid);
}
