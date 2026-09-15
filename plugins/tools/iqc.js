import axios from 'axios'
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const BASE = join(os.homedir(), '.rezora-iqc')
const FONT_DIR = join(BASE, 'fonts')
const FONT_PATH = join(FONT_DIR, 'Inter-Regular.ttf')
const BG_PATH = join(BASE, 'iqc-hytam.png')
const EMOJI_PATH = join(FONT_DIR, 'emoji-apple-image.json')

const FONT_URL = 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2'
const BG_URL = 'https://raw.githubusercontent.com/ryyntwx/allimagerin/refs/heads/main/iqc-hytam.png'
const EMOJI_URL = 'https://media.githubusercontent.com/media/Ditzzx-vibecoder/entahlah/main/emoji-apple.json'

let initialized = false
let emojiMap = null
const emojiCache = new Map()

const EMOJI_REGEX = /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu

async function download(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0'
        }
    })
    return Buffer.from(res.data)
}

async function init() {
    if (initialized) return

    await mkdir(FONT_DIR, { recursive: true })

    const tasks = []

    if (!existsSync(FONT_PATH)) {
        tasks.push(
            download(FONT_URL).then(b =>
                writeFile(FONT_PATH, b)
            )
        )
    }

    if (!existsSync(BG_PATH)) {
        tasks.push(
            download(BG_URL).then(b =>
                writeFile(BG_PATH, b)
            )
        )
    }

    if (!existsSync(EMOJI_PATH)) {
        tasks.push(
            download(EMOJI_URL).then(b =>
                writeFile(EMOJI_PATH, b)
            )
        )
    }

    await Promise.all(tasks)

    if (!GlobalFonts.families.some(
        x => x.family === 'InterRegular'
    )) {
        GlobalFonts.registerFromPath(
            FONT_PATH,
            'InterRegular'
        )
    }

    emojiMap = JSON.parse(
        await readFile(EMOJI_PATH, 'utf8')
    )

    initialized = true
}

function getRealtime() {
    return new Intl.DateTimeFormat(
        'id-ID',
        {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }
    ).format(new Date())
}

function emojiCode(emoji) {
    return [...emoji]
        .map(x =>
            x.codePointAt(0)
                .toString(16)
                .padStart(4, '0')
        )
        .join('-')
}

async function getEmoji(emoji) {
    if (emojiCache.has(emoji))
        return emojiCache.get(emoji)

    const base = emojiCode(emoji)

    const keys = [
        base,
        base.replace(/-fe0f/gi, ''),
        `${base.replace(/-fe0f/gi, '')}-fe0f`,
        base.toUpperCase(),
        base.replace(/-fe0f/gi, '').toUpperCase()
    ]

    let data

    for (const key of keys) {
        if (emojiMap?.[key]) {
            data = emojiMap[key]
            break
        }
    }

    if (!data)
        return null

    const image = await loadImage(
        Buffer.from(data, 'base64')
    )

    emojiCache.set(emoji, image)

    return image
}

function measureText(ctx, text, size) {
    ctx.font = `${size}px InterRegular`

    let width = 0

    for (const part of text.split(EMOJI_REGEX)) {
        if (!part) continue

        EMOJI_REGEX.lastIndex = 0

        if (EMOJI_REGEX.test(part)) {
            width += size * 1.05
        } else {
            width += ctx.measureText(part).width
        }

        EMOJI_REGEX.lastIndex = 0
    }

    return width
}

async function drawText(ctx, text, x, y, size) {
    ctx.font = `${size}px InterRegular`
    ctx.textBaseline = 'middle'

    let currentX = x

    for (const part of text.split(EMOJI_REGEX)) {
        if (!part) continue

        EMOJI_REGEX.lastIndex = 0

        if (EMOJI_REGEX.test(part)) {
            const img = await getEmoji(part)
            const emojiSize = size * 1.05

            if (img) {
                ctx.drawImage(
                    img,
                    currentX,
                    y - emojiSize / 2,
                    emojiSize,
                    emojiSize
                )
            } else {
                ctx.fillText(
                    part,
                    currentX,
                    y
                )
            }

            currentX += emojiSize
        } else {
            ctx.fillText(
                part,
                currentX,
                y
            )

            currentX += ctx.measureText(part).width
        }

        EMOJI_REGEX.lastIndex = 0
    }
}

function wrapText(ctx, text, maxWidth, size) {
    ctx.font = `${size}px InterRegular`

    const words = String(text)
        .split(/\s+/)
        .filter(Boolean)

    const lines = []
    let current = ''

    for (const word of words) {
        const test = current
            ? `${current} ${word}`
            : word

        if (
            measureText(ctx, test, size) <= maxWidth
        ) {
            current = test
        } else {
            if (current)
                lines.push(current)

            current = word
        }
    }

    if (current)
        lines.push(current)

    return lines.length ? lines : ['']
}

function roundedBubble(ctx, x, y, w, h, r) {
    ctx.beginPath()

    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)

    ctx.quadraticCurveTo(
        x + w,
        y,
        x + w,
        y + r
    )

    ctx.lineTo(
        x + w,
        y + h - r
    )

    ctx.quadraticCurveTo(
        x + w,
        y + h,
        x + w - r,
        y + h
    )

    ctx.lineTo(
        x + r,
        y + h
    )

    ctx.quadraticCurveTo(
        x + 8,
        y + h,
        x + 8,
        y + h - 8
    )

    ctx.lineTo(
        x + 8,
        y + r
    )

    ctx.quadraticCurveTo(
        x + 8,
        y,
        x + r,
        y
    )

    ctx.closePath()
}

async function getImage(m, sock) {
    if (m.quoted) {
        try {
            const buffer = await m.download()

            if (
                buffer &&
                Buffer.isBuffer(buffer) &&
                buffer.length
            ) {
                return buffer
            }
        } catch {}
    }

    if (m.type === 'imageMessage') {
        try {
            const buffer = await m.download()

            if (
                buffer &&
                Buffer.isBuffer(buffer) &&
                buffer.length
            ) {
                return buffer
            }
        } catch {}
    }

    try {
        const pp = await sock.profilePictureUrl(
            m.sender,
            'image'
        )

        if (pp)
            return await download(pp)
    } catch {}

    return null
}

const __plugin =  {
    cmd: ['iqc', 'iqchat'],
    category: 'maker',

    run: async (m, { sock, text }) => {
        let output = null

        try {
            await m.react('⏳')
            await init()

            const parts = String(text || '')
                .split('|')

            const messageText =
                parts[0]?.trim() || 'halo'

            /*
             * Otomatis realtime WIB.
             * Kalau user menulis:
             *
             * .iqc halo | 13.45
             *
             * maka waktu custom tetap digunakan.
             */

            const time =
                parts[1]?.trim() ||
                getRealtime()

            const imageBuffer =
                await getImage(m, sock)

            const source = imageBuffer
                ? await loadImage(imageBuffer)
                : null

            const canvas =
                createCanvas(941, 1671)

            const ctx =
                canvas.getContext('2d')

            const background =
                await loadImage(
                    await readFile(BG_PATH)
                )

            ctx.drawImage(
                background,
                0,
                0,
                941,
                1671
            )

            /*
             * Jam status bar
             */

            ctx.fillStyle = '#ffffff'
            ctx.font = '27px InterRegular'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'

            ctx.fillText(
                time,
                463,
                8
            )

            /*
             * Bubble
             */

            const X = 35
            const MAX_W = 530
            const MIN_W = 280
            const BASE_Y = 946

            const FONT_SIZE = 30
            const LINE_HEIGHT = 44

            const PAD_X = 30
            const PAD_Y = 20

            ctx.font =
                `${FONT_SIZE}px InterRegular`

            const lines = wrapText(
                ctx,
                messageText,
                MAX_W - PAD_X * 2,
                FONT_SIZE
            )

            let longest = 0

            for (const line of lines) {
                longest = Math.max(
                    longest,
                    measureText(
                        ctx,
                        line,
                        FONT_SIZE
                    )
                )
            }

            const bubbleW = Math.max(
                MIN_W,
                Math.min(
                    MAX_W,
                    longest + PAD_X * 2
                )
            )

            let imageH = 0

            if (source) {
                const ratio =
                    source.width /
                    source.height

                imageH = Math.min(
                    Math.round(
                        bubbleW / ratio
                    ),
                    620
                )
            }

            const textH =
                PAD_Y +
                lines.length * LINE_HEIGHT

            const timeH = 30

            const bubbleH =
                imageH +
                textH +
                timeH +
                4

            const bubbleY =
                BASE_Y - bubbleH

            /*
             * Bubble background
             */

            ctx.fillStyle = '#1c1c1e'

            roundedBubble(
                ctx,
                X,
                bubbleY,
                bubbleW,
                bubbleH,
                28
            )

            ctx.fill()

            /*
             * Foto hanya jika ada
             */

            if (source) {
                ctx.save()

                ctx.beginPath()

                ctx.moveTo(
                    X + 28,
                    bubbleY
                )

                ctx.lineTo(
                    X + bubbleW - 28,
                    bubbleY
                )

                ctx.quadraticCurveTo(
                    X + bubbleW,
                    bubbleY,
                    X + bubbleW,
                    bubbleY + 28
                )

                ctx.lineTo(
                    X + bubbleW,
                    bubbleY + imageH
                )

                ctx.lineTo(
                    X + 8,
                    bubbleY + imageH
                )

                ctx.lineTo(
                    X + 8,
                    bubbleY + 28
                )

                ctx.quadraticCurveTo(
                    X + 8,
                    bubbleY,
                    X + 28,
                    bubbleY
                )

                ctx.closePath()

                ctx.clip()

                ctx.drawImage(
                    source,
                    X,
                    bubbleY,
                    bubbleW,
                    imageH
                )

                ctx.restore()
            }

            /*
             * Text
             */

            ctx.fillStyle = '#ffffff'
            ctx.font =
                `${FONT_SIZE}px InterRegular`

            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'

            for (
                let i = 0;
                i < lines.length;
                i++
            ) {
                await drawText(
                    ctx,
                    lines[i],
                    X + PAD_X,
                    bubbleY +
                    imageH +
                    PAD_Y +
                    i * LINE_HEIGHT +
                    FONT_SIZE / 2,
                    FONT_SIZE
                )
            }

            /*
             * Waktu bubble
             */

            ctx.fillStyle = '#727278'
            ctx.font = '22px InterRegular'
            ctx.textAlign = 'right'
            ctx.textBaseline = 'middle'

            ctx.fillText(
                time,
                X + bubbleW - 22,
                bubbleY +
                bubbleH -
                timeH
            )

            /*
             * Reaction bar
             */

            const emojis = [
                '👍',
                '❤️',
                '😂',
                '😮',
                '😢',
                '🙏'
            ]

            const CARD_H = 100
            const CARD_W = 545

            const CARD_X = X + 8
            const CARD_Y =
                bubbleY -
                CARD_H -
                18

            ctx.fillStyle = '#1c1c1e'

            ctx.beginPath()

            ctx.roundRect(
                CARD_X,
                CARD_Y,
                CARD_W,
                CARD_H,
                CARD_H / 2
            )

            ctx.fill()

            const START_X =
                CARD_X + 55

            const SPACING = 76

            for (
                let i = 0;
                i < emojis.length;
                i++
            ) {
                const emoji =
                    await getEmoji(
                        emojis[i]
                    )

                if (emoji) {
                    ctx.drawImage(
                        emoji,
                        START_X +
                        i * SPACING -
                        28,
                        CARD_Y + 22,
                        56,
                        56
                    )
                }
            }

            ctx.fillStyle = '#8e8e93'
            ctx.font = '37px InterRegular'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'

            ctx.fillText(
                '+',
                START_X +
                6 * SPACING -
                8,
                CARD_Y +
                CARD_H / 2
            )

            /*
             * Simpan temporary
             */

            output = join(
                os.tmpdir(),
                `rezora-iqc-${Date.now()}.png`
            )

            await writeFile(
                output,
                await canvas.encode('png')
            )

            /*
             * Kirim melalui socket utama Rezora
             */

            await sock.sendMessage(
                m.chat,
                {
                    image: await readFile(output),
                    caption: ''
                },
                {
                    quoted: m
                }
            )

            await m.react('✅')

        } catch (e) {
            console.error(
                '[IQC ERROR]',
                e
            )

            await m.react('❌')
                .catch(() => {})

            return m.reply(
                `Gagal membuat IQC: ${e.message || e}`
            )

        } finally {
            if (
                output &&
                existsSync(output)
            ) {
                await unlink(output)
                    .catch(() => {})
            }
        }
    }
};

let handler = async (m, ctx) => {
  const sock = ctx.sock || ctx.conn
  const conn = ctx.conn || sock
  const text = ctx.text || m.body || ''
  const args = ctx.args || m.args || []
  const prefix = ctx.prefix || ctx.usedPrefix || m.usedPrefix || '.'
  const usedPrefix = prefix
  const command = ctx.command || m.command
  const config = ctx.config || {}
  const isOwner = ctx.isOwner
  const isPremium = ctx.isPremium
  if (typeof __plugin.run !== 'function') throw new Error('Plugin run missing')
  return __plugin.run(m, {
    sock, conn, text, args, prefix, usedPrefix, command, cmd: command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin,
  })
}

handler.command = __plugin.cmd || ['iqc', 'iqchat']
handler.help = __plugin.help || __plugin.cmd || ['iqc', 'iqchat']
handler.tags = [__plugin.category || 'maker']

export default handler
