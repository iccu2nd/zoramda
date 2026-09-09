/**
 * Wrapper pengiriman pesan tambahan untuk Baileys socket.
 *
 * Diporting dari implementasi yang sudah terbukti jalan di project Rezora
 * (lib/simple.js) — bukan sistem baru, hanya dipasang ulang di sini supaya
 * konsisten dan langsung kompatibel dengan Baileys.
 *
 * Menambahkan pada tiap instance sock:
 *   - sock.sendSticker(jid, buffer, quoted, options)
 *   - sock.sendAudio(jid, source, ptt, quoted, options)
 *   - sock.sendAlbum(jid, items, options)
 *   - sock.sendButton(jid, content, options)
 *
 * Panggil attachMessageWrappers(sock) sekali, persis setelah makeWASocket().
 * Semua plugin memakainya lewat `conn` di ctx (ctx.conn === sock), sama
 * seperti `conn.sendMessage(...)` yang sudah dipakai plugin lain.
 */
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { PassThrough, Readable } from 'stream'
import ffmpeg from 'fluent-ffmpeg'
import WebP from 'node-webpmux'
import {
  proto,
  generateWAMessageFromContent,
  generateWAMessage,
  prepareWAMessageMedia,
} from '@whiskeysockets/baileys'
import logger from '../utils/logger.js'

const TMP_DIR = path.join(os.tmpdir(), 'botenv-media')

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true })
}

function tmpFile(ext) {
  ensureTmpDir()
  return path.join(TMP_DIR, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`)
}

async function cleanupFiles(paths) {
  await Promise.all(paths.map((p) => fsp.unlink(p).catch(() => {})))
}

/** Convert audio (buffer/url/stream) ke Opus/OGG mono 48k — format voice note WhatsApp. */
export function convertToOpus(input) {
  return new Promise((resolve, reject) => {
    const output = new PassThrough()
    const buffers = []
    const source = Buffer.isBuffer(input) ? Readable.from(input) : input

    ffmpeg(source)
      .audioCodec('libopus')
      .audioChannels(1)
      .audioFrequency(48000)
      .audioBitrate(64)
      .toFormat('ogg')
      .addOutputOptions([
        '-map_metadata', '-1',
        '-vn',
        '-threads', '0',
        '-application', 'voip',
        '-compression_level', '0',
      ])
      .on('error', (err) => reject(err))
      .pipe(output)

    output.on('data', (chunk) => buffers.push(chunk))
    output.on('end', () => resolve(Buffer.concat(buffers)))
  })
}

function isWebpBuffer(buffer) {
  return (
    buffer.length > 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  )
}

function isGifBuffer(buffer) {
  return buffer.length > 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46
}

function isMp4Buffer(buffer) {
  return buffer.length > 11 && buffer.slice(4, 8).toString('ascii') === 'ftyp'
}

/**
 * Suntik EXIF sticker pack (name/author) ke buffer webp mentah.
 * Ini bagian penting supaya WhatsApp mengenali file sebagai *sticker*,
 * bukan sekadar gambar/dokumen webp biasa.
 */
async function injectStickerExif(webpBuffer, { packname, author }) {
  const img = new WebP.Image()
  await img.load(webpBuffer)
  const json = {
    'sticker-pack-id': `botenv-${Date.now()}`,
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    emojis: ['🤖'],
  }
  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ])
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
  const exif = Buffer.concat([exifHeader, jsonBuffer])
  exif.writeUIntLE(jsonBuffer.length, 14, 4)
  img.exif = exif
  return img.save(null)
}

/**
 * Ubah buffer gambar/video/gif apapun jadi webp siap-kirim WhatsApp
 * (512x512, EXIF pack sudah disuntik). Kalau buffer sudah webp valid,
 * langsung disuntik EXIF tanpa re-encode (lebih cepat).
 */
async function toStickerWebp(buffer, { packname, author, isAnimated, crop }) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('sendSticker butuh Buffer, bukan url/string')
  }

  if (isWebpBuffer(buffer) && !crop) {
    return injectStickerExif(buffer, { packname, author })
  }

  const isVideo = !!isAnimated || isMp4Buffer(buffer)
  const isGif = isGifBuffer(buffer)
  const ext = isVideo ? 'mp4' : isGif ? 'gif' : 'jpg'

  const fileIn = tmpFile(ext)
  const fileOut = tmpFile('webp')
  await fsp.writeFile(fileIn, buffer)

  const inputArgs = []
  const outputArgs = [
    '-vcodec', 'libwebp',
    '-vf', crop
      ? "crop='min(iw\\,ih)':'min(iw\\,ih)',scale=512:512,format=rgba"
      : 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000@0,format=rgba',
    '-loop', '0',
    '-an',
  ]

  if (isVideo || isGif) {
    inputArgs.push('-t', '6')
    outputArgs.push('-preset', 'default', '-qscale', '20', '-vsync', 'cfr', '-r', '15')
  } else {
    outputArgs.push('-preset', 'default', '-qscale', '70')
  }

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(fileIn)
        .addInputOptions(inputArgs)
        .addOutputOptions(outputArgs)
        .toFormat('webp')
        .save(fileOut)
        .on('end', resolve)
        .on('error', reject)
    })

    const stat = await fsp.stat(fileOut).catch(() => null)
    if (!stat || stat.size === 0) {
      throw new Error('Gagal membuat stiker: output ffmpeg kosong')
    }

    const webpBuffer = await fsp.readFile(fileOut)
    if (webpBuffer.length > 1_000_000) {
      throw new Error('Ukuran stiker terlalu besar setelah convert (>1MB)')
    }

    return injectStickerExif(webpBuffer, { packname, author })
  } finally {
    await cleanupFiles([fileIn, fileOut])
  }
}

/* ------------------------------------------------------------------ */
/*  Interactive button builder — semua tipe button yang ada di Rezora  */
/* ------------------------------------------------------------------ */

class InteractiveButtonBuilder {
  constructor(sock) {
    this.sock = sock
    this.buttons = []
  }

  addReply(displayText = '', id = '') {
    this.buttons.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: displayText, id }),
    })
    return this
  }

  addUrl(displayText = '', url = '', webviewInteraction = false) {
    this.buttons.push({
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({ display_text: displayText, url, webview_interaction: webviewInteraction }),
    })
    return this
  }

  addCopy(displayText = '', copyCode = '') {
    this.buttons.push({
      name: 'cta_copy',
      buttonParamsJson: JSON.stringify({ display_text: displayText, copy_code: copyCode }),
    })
    return this
  }

  addCall(displayText = '', phoneNumber = '') {
    this.buttons.push({
      name: 'cta_call',
      buttonParamsJson: JSON.stringify({ display_text: displayText, id: phoneNumber }),
    })
    return this
  }

  addLocation() {
    this.buttons.push({ name: 'send_location', buttonParamsJson: JSON.stringify({}) })
    return this
  }

  addAddress(displayText = '', id = '') {
    this.buttons.push({
      name: 'address_message',
      buttonParamsJson: JSON.stringify({ display_text: displayText, id }),
    })
    return this
  }

  addReminder(displayText = '', id = '') {
    this.buttons.push({
      name: 'cta_reminder',
      buttonParamsJson: JSON.stringify({ display_text: displayText, id }),
    })
    return this
  }

  addCancelReminder(displayText = '', id = '') {
    this.buttons.push({
      name: 'cta_cancel_reminder',
      buttonParamsJson: JSON.stringify({ display_text: displayText, id }),
    })
    return this
  }

  /** List/quick-reply gabungan (single_select) dengan section + row. */
  addList(title = '', sections = []) {
    this.buttons.push({
      name: 'single_select',
      buttonParamsJson: JSON.stringify({
        title,
        sections: sections.map((s) => ({
          title: s.title || '',
          highlight_label: s.highlight_label || '',
          rows: (s.rows || []).map((r) => ({
            header: r.header || '',
            title: r.title || '',
            description: r.description || '',
            id: r.id || '',
          })),
        })),
      }),
    })
    return this
  }

  async build(jid, { text = '', footer = '', title = '', image, video, contextInfo = {}, quoted = null } = {}) {
    let header = { title, hasMediaAttachment: false }
    if (image || video) {
      const mediaInput = image
        ? typeof image === 'string' ? { url: image } : image
        : typeof video === 'string' ? { url: video } : video
      const media = await prepareWAMessageMedia(
        { [image ? 'image' : 'video']: mediaInput },
        { upload: this.sock.waUploadToServer }
      )
      header = { title, hasMediaAttachment: true, ...media }
    }

    return generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
              body: { text },
              footer: { text: footer },
              header,
              nativeFlowMessage: { buttons: this.buttons },
              contextInfo,
            }),
          },
        },
      },
      { userJid: this.sock.user.id, quoted }
    )
  }

  async send(jid, options = {}) {
    const msg = await this.build(jid, options)
    await this.sock.relayMessage(msg.key.remoteJid, msg.message, {
      messageId: msg.key.id,
      additionalNodes: [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
            },
          ],
        },
      ],
    })
    return msg
  }
}

/** Terima list button "plugin-friendly" (plain object) lalu susun jadi builder. */
function buildFromContent(sock, buttons = []) {
  const builder = new InteractiveButtonBuilder(sock)
  for (const btn of buttons) {
    const type = btn.type || 'reply'
    switch (type) {
      case 'reply':
        builder.addReply(btn.text || btn.displayText, btn.id)
        break
      case 'url':
        builder.addUrl(btn.text || btn.displayText, btn.url, !!btn.webview)
        break
      case 'copy':
        builder.addCopy(btn.text || btn.displayText, btn.code || btn.copyCode)
        break
      case 'call':
        builder.addCall(btn.text || btn.displayText, btn.phone || btn.id)
        break
      case 'location':
        builder.addLocation()
        break
      case 'address':
        builder.addAddress(btn.text || btn.displayText, btn.id)
        break
      case 'reminder':
        builder.addReminder(btn.text || btn.displayText, btn.id)
        break
      case 'cancel_reminder':
        builder.addCancelReminder(btn.text || btn.displayText, btn.id)
        break
      case 'list':
        builder.addList(btn.text || btn.displayText || btn.title, btn.sections || [])
        break
      default:
        builder.addReply(btn.text || btn.displayText, btn.id)
    }
  }
  return builder
}

/**
 * Pasang seluruh wrapper pengiriman pesan ke satu instance sock Baileys.
 * Idempotent-safe untuk dipanggil ulang (overwrite method yang sama).
 */
export function attachMessageWrappers(sock) {
  /**
   * sock.sendSticker(jid, buffer, quoted, options)
   * - buffer: Buffer gambar/video/gif/webp mentah (bukan url)
   * - options.isAnimated: true kalau buffer adalah video (sticker animasi)
   * - options.crop: true untuk crop-square, default pad ke 512x512
   * - options.packname / options.author: metadata pack di EXIF
   */
  sock.sendSticker = async (jid, buffer, quoted = null, options = {}) => {
    const { packname = 'Botenv', author = '', isAnimated = false, crop = false, ...rest } = options
    try {
      const finalBuffer = await toStickerWebp(buffer, { packname, author, isAnimated, crop })
      return await sock.sendMessage(jid, { sticker: finalBuffer, ...rest }, { quoted })
    } catch (err) {
      logger.error({ jid, err: err?.message }, 'sendSticker failed')
      throw err
    }
  }

  /**
   * sock.sendAudio(jid, source, ptt, quoted, options)
   * - source: Buffer atau url string
   * - ptt=true → dikonversi ke ogg/opus (voice note asli)
   * - ptt=false → audio biasa (mp3/dll, apa adanya)
   */
  sock.sendAudio = async (jid, source, ptt = false, quoted = null, options = {}) => {
    if (ptt) {
      const buffer = await convertToOpus(source)
      return sock.sendMessage(
        jid,
        { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus', ...options },
        { quoted }
      )
    }
    const payload = typeof source === 'string' ? { url: source } : source
    return sock.sendMessage(
      jid,
      { audio: payload, ptt: false, mimetype: 'audio/mpeg', ...options },
      { quoted }
    )
  }

  /**
   * sock.sendAlbum(jid, items, options)
   * - items: [{ image: buffer|url|{url} }, { video: ... }, ...]
   */
  sock.sendAlbum = async (jid, items = [], options = {}) => {
    if (!sock.user?.id) throw new Error('Socket belum authenticated')
    const messageSecret = crypto.randomBytes(32)
    const albumContent = {
      messageContextInfo: { messageSecret },
      albumMessage: {
        expectedImageCount: items.filter((i) => i.image).length,
        expectedVideoCount: items.filter((i) => i.video).length,
      },
    }
    const album = generateWAMessageFromContent(jid, albumContent, {
      userJid: sock.user.id,
      upload: sock.waUploadToServer,
      quoted: options.quoted || null,
    })
    await sock.relayMessage(album.key.remoteJid, album.message, { messageId: album.key.id })

    for (const item of items) {
      const mediaSecret = crypto.randomBytes(32)
      const mediaMsg = await generateWAMessage(album.key.remoteJid, item, {
        upload: sock.waUploadToServer,
      })
      mediaMsg.message.messageContextInfo = {
        messageSecret: mediaSecret,
        messageAssociation: { associationType: 1, parentMessageKey: album.key },
      }
      await sock.relayMessage(mediaMsg.key.remoteJid, mediaMsg.message, { messageId: mediaMsg.key.id })
    }
    return album
  }

  /**
   * sock.sendButton(jid, content, options)
   * content.buttons: array of { type, text/displayText, ...type-specific fields }
   *   type: 'reply' | 'url' | 'copy' | 'call' | 'location' | 'address'
   *       | 'reminder' | 'cancel_reminder' | 'list' (pakai content.sections)
   * content: { text, footer, title, image?, video? }
   * options: { quoted, mentions, contextInfo }
   */
  sock.sendButton = async (jid, content = {}, options = {}) => {
    const builder = buildFromContent(sock, content.buttons || [])
    return builder.send(jid, {
      text: content.text || content.caption || '',
      footer: content.footer || '',
      title: content.title || '',
      image: content.image,
      video: content.video,
      contextInfo: { mentionedJid: options.mentions || [], ...options.contextInfo },
      quoted: options.quoted || null,
    })
  }

  return sock
}

export default attachMessageWrappers
