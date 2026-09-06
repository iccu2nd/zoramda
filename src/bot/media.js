import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import config from '../config/index.js';

const TMP_DIR = path.join(config.dataDir, 'tmp');

function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

export function tmpFile(ext = 'bin') {
  ensureTmp();
  return path.join(TMP_DIR, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
}

/**
 * Convert audio to OGG/Opus for WhatsApp PTT (voice note).
 * Requires ffmpeg binary + fluent-ffmpeg.
 */
export async function convertToOpus(input) {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const buffers = [];
    const source = Buffer.isBuffer(input) ? Readable.from(input) : input;

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
        '-compression_level', '0'
      ])
      .on('error', (err) => reject(err))
      .pipe(output);

    output.on('data', (chunk) => buffers.push(chunk));
    output.on('end', () => resolve(Buffer.concat(buffers)));
    output.on('error', reject);
  });
}

/**
 * Convert image/gif/video buffer to WebP sticker.
 * Requires ffmpeg binary + fluent-ffmpeg.
 */
export async function convertToWebpSticker(buffer, { isVideo = false, crop = false } = {}) {
  const { default: ffmpeg } = await import('fluent-ffmpeg');

  const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  const isMp4 = isVideo;
  const ext = isMp4 ? 'mp4' : isGif ? 'gif' : 'jpg';

  const tempIn = tmpFile(ext);
  const tempOut = tmpFile('webp');

  const cleanup = async () => {
    await fsp.unlink(tempIn).catch(() => {});
    await fsp.unlink(tempOut).catch(() => {});
  };

  await fsp.writeFile(tempIn, buffer);

  const inputArgs = [];
  const args = [
    '-vcodec', 'libwebp',
    '-vf', crop
      ? "crop='min(iw\\,ih)':'min(iw\\,ih)',scale=512:512,format=rgba"
      : "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000@0,format=rgba",
    '-loop', '0',
    '-an'
  ];

  if (isVideo || isGif) {
    inputArgs.push('-t', '6');
    args.push('-preset', 'default', '-qscale', '20', '-vsync', 'cfr', '-r', '15');
  } else {
    args.push('-preset', 'default', '-qscale', '70');
  }

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(tempIn)
        .addInputOptions(inputArgs)
        .addOutputOptions(args)
        .toFormat('webp')
        .save(tempOut)
        .on('end', resolve)
        .on('error', reject);
    });

    const outStat = await fsp.stat(tempOut).catch(() => null);
    if (!outStat || outStat.size === 0) {
      throw new Error('Sticker conversion failed (empty output)');
    }

    const webpBuffer = await fsp.readFile(tempOut);
    if (webpBuffer.length > 1_000_000) {
      throw new Error('Sticker terlalu besar (>1MB). Gunakan media lebih pendek/kecil.');
    }
    return webpBuffer;
  } finally {
    await cleanup();
  }
}

/**
 * Inject WhatsApp sticker EXIF (packname / author).
 * Requires node-webpmux.
 */
export async function injectStickerExif(webpBuf, { packname = 'ZoraBot', author = 'ZoraBot' } = {}) {
  const WebP = (await import('node-webpmux')).default;
  const img = new WebP.Image();
  await img.load(webpBuf);
  const json = {
    'sticker-pack-id': `zorabot-${Date.now()}`,
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    emojis: ['✨']
  };
  const exifHeader = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const exif = Buffer.concat([exifHeader, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);
  img.exif = exif;
  return img.save(null);
}

export function isWebpBuffer(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  );
}

export async function fetchBuffer(url, { timeoutMs = 20000, retries = 2 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      clearTimeout(timer);
      const msg = error?.message || String(error);
      const retryable = /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|abort|network/i.test(msg);
      if (!retryable || attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  return Buffer.alloc(0);
}
