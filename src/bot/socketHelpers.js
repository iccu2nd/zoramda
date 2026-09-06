import crypto from 'node:crypto';
import {
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  generateWAMessage,
  generateMessageID,
  getBinaryNodeChild
} from '@whiskeysockets/baileys';
import {
  convertToOpus,
  convertToWebpSticker,
  injectStickerExif,
  isWebpBuffer,
  fetchBuffer
} from './media.js';
import { getGroupEphemeral } from './groupCache.js';

/**
 * Attach convenience send helpers to a Baileys socket.
 * Isolated per bot — call once after makeWASocket.
 */
export function wrapSocket(sock, { botName = 'ZoraBot' } = {}) {
  if (!sock || sock.__zorabotWrapped) return sock;
  sock.__zorabotWrapped = true;
  sock.generateMessageID = generateMessageID;

  const originalSend = sock.sendMessage?.bind(sock);

  sock.sendMessage = async (jid, content, options = {}) => {
    if (!jid || !content) return;
    if (!content.contextInfo) content.contextInfo = {};
    if (typeof jid === 'string' && jid.endsWith('@g.us')) {
      const expiration = getGroupEphemeral(jid);
      if (expiration) content.contextInfo.expiration = expiration;
    }
    const { pluginName, ...sendOptions } = options;
    return originalSend(jid, content, sendOptions);
  };

  // ---- Basic media ----
  sock.sendImage = async (jid, media, caption = '', quoted = null, options = {}) => {
    const payload = resolveMedia(media);
    return sock.sendMessage(jid, { image: payload, caption: String(caption), ...options }, { quoted });
  };

  sock.sendVideo = async (jid, media, caption = '', quoted = null, { gif = false, ...options } = {}) => {
    const payload = resolveMedia(media);
    return sock.sendMessage(
      jid,
      { video: payload, caption: String(caption), gifPlayback: !!gif, ...options },
      { quoted }
    );
  };

  /**
   * Send audio or voice note (PTT).
   * ptt:true converts to opus when possible.
   */
  sock.sendAudio = async (jid, media, { ptt = false, quoted = null, ...options } = {}) => {
    let source = resolveMedia(media);
    if (ptt) {
      let buf = source;
      if (source?.url) buf = await fetchBuffer(source.url);
      if (!Buffer.isBuffer(buf)) throw new Error('Voice note membutuhkan buffer atau URL valid');
      const opus = await convertToOpus(buf);
      return sock.sendMessage(
        jid,
        { audio: opus, ptt: true, mimetype: 'audio/ogg; codecs=opus', ...options },
        { quoted }
      );
    }
    return sock.sendMessage(
      jid,
      {
        audio: source,
        ptt: false,
        mimetype: options.mimetype || 'audio/mpeg',
        ...options
      },
      { quoted }
    );
  };

  sock.sendVN = (jid, media, quoted = null, options = {}) =>
    sock.sendAudio(jid, media, { ptt: true, quoted, ...options });

  /**
   * Sticker from buffer / URL / webp.
   * Options: packname, author, isAnimated, crop
   */
  sock.sendSticker = async (jid, media, quoted = null, options = {}) => {
    let buffer = media;
    if (typeof media === 'string') {
      buffer = await fetchBuffer(media);
    } else if (media?.url) {
      buffer = await fetchBuffer(media.url);
    }
    if (!Buffer.isBuffer(buffer)) throw new Error('Sticker media tidak valid');

    const packname = options.packname ?? botName;
    const author = options.author ?? botName;
    const isVideo = !!options.isAnimated;
    const crop = !!options.crop;

    let webp = buffer;
    if (!(isWebpBuffer(buffer) && !isVideo && !crop)) {
      webp = await convertToWebpSticker(buffer, { isVideo, crop });
    }
    const finalBuffer = await injectStickerExif(webp, { packname, author });
    const { packname: _p, author: _a, isAnimated, crop: _c, ...rest } = options;
    return sock.sendMessage(jid, { sticker: finalBuffer, ...rest }, { quoted });
  };

  /**
   * Album: multiple images/videos in one album message.
   * items: [{ image: url|Buffer }, { video: url|Buffer }, ...]
   */
  sock.sendAlbum = async (jid, items = [], options = {}) => {
    if (!sock.user?.id) throw new Error('User not authenticated');
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('sendAlbum membutuhkan minimal 1 item');
    }

    const messageSecret = crypto.randomBytes(32);
    const album = generateWAMessageFromContent(
      jid,
      {
        messageContextInfo: { messageSecret },
        albumMessage: {
          expectedImageCount: items.filter((a) => a.image).length,
          expectedVideoCount: items.filter((a) => a.video).length
        }
      },
      {
        userJid: sock.user.id,
        upload: sock.waUploadToServer,
        quoted: options.quoted || null,
        ephemeralExpiration: options.quoted?.expiration || 0
      }
    );

    await sock.relayMessage(album.key.remoteJid, album.message, { messageId: album.key.id });

    for (const content of items) {
      const mediaSecret = crypto.randomBytes(32);
      const mediaMsg = await generateWAMessage(album.key.remoteJid, content, {
        upload: sock.waUploadToServer,
        ephemeralExpiration: options.quoted?.expiration || 0
      });
      mediaMsg.message.messageContextInfo = {
        messageSecret: mediaSecret,
        messageAssociation: { associationType: 1, parentMessageKey: album.key }
      };
      await sock.relayMessage(mediaMsg.key.remoteJid, mediaMsg.message, {
        messageId: mediaMsg.key.id
      });
    }
    return album;
  };

  /**
   * Interactive buttons (native flow).
   * Supports: reply, url, copy, call, location, address, reminder, cancel_reminder, list
   */
  sock.sendButton = async (jid, content = {}, options = {}) => {
    const {
      text = '',
      footer = '',
      title = '',
      subtitle = '',
      buttons = [],
      image,
      video,
      document,
      contextInfo = {},
      params = {}
    } = content;

    const nativeButtons = [];
    for (const btn of buttons) {
      nativeButtons.push(normalizeButton(btn));
    }

    let mediaPayload = null;
    if (image) mediaPayload = { image: resolveMedia(image) };
    else if (video) mediaPayload = { video: resolveMedia(video) };
    else if (document) mediaPayload = { document: resolveMedia(document) };

    let headerMedia = {};
    if (mediaPayload) {
      try {
        headerMedia = await prepareWAMessageMedia(mediaPayload, {
          upload: sock.waUploadToServer
        });
      } catch (e) {
        if (!String(e).includes('Invalid media type')) throw e;
        headerMedia = mediaPayload;
      }
    }

    const msg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
              body: { text: text || content.caption || '' },
              footer: { text: footer },
              header: {
                title,
                subtitle,
                hasMediaAttachment: !!mediaPayload,
                ...headerMedia
              },
              nativeFlowMessage: {
                messageParamsJson: JSON.stringify(params),
                buttons: nativeButtons
              },
              contextInfo: {
                mentionedJid: options.mentions || [],
                ...contextInfo,
                ...options.contextInfo
              }
            })
          }
        }
      },
      { userJid: sock.user?.id, quoted: options.quoted || null }
    );

    await sock.relayMessage(jid, msg.message, {
      messageId: msg.key.id,
      additionalNodes: [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
            }
          ]
        }
      ]
    });
    return msg;
  };

  /**
   * Legacy-style buttons (ButtonV2 / buttonsMessage).
   */
  sock.sendButtonV2 = async (jid, content = {}, options = {}) => {
    const buttons = (content.buttons || []).map((btn, i) => ({
      buttonId: btn.id || `btn_${i + 1}`,
      buttonText: { displayText: btn.label || btn.displayText || `Button ${i + 1}` },
      type: 1
    }));
    if (buttons.length < 1) throw new Error('sendButtonV2 membutuhkan minimal 1 button');

    let mediaPart = null;
    if (content.image || content.video) {
      const key = content.image ? 'image' : 'video';
      const media = await prepareWAMessageMedia(
        { [key]: resolveMedia(content.image || content.video) },
        { upload: sock.waUploadToServer }
      );
      mediaPart = media;
    }

    const msg = generateWAMessageFromContent(
      jid,
      {
        buttonsMessage: {
          contentText: content.body || content.text || '',
          footerText: content.footer || '',
          headerType: mediaPart ? (content.image ? 4 : 5) : 1,
          ...mediaPart,
          viewOnce: true,
          contextInfo: content.contextInfo || options.contextInfo || {},
          buttons
        }
      },
      { userJid: sock.user?.id, quoted: options.quoted || null }
    );

    await sock.relayMessage(jid, msg.message, {
      messageId: msg.key.id,
      additionalNodes: [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
            }
          ]
        }
      ]
    });
    return msg;
  };

  /**
   * Simple carousel via multiple interactive cards.
   */
  sock.sendCarousel = async (jid, content = {}, options = {}) => {
    const { text = '', footer = '', cards = [], quoted = null } = content;
    const carouselCards = [];

    for (const item of cards) {
      const mediaInput = resolveMedia(item.image || item.video);
      const key = item.video ? 'video' : 'image';
      const media = await prepareWAMessageMedia(
        { [key]: mediaInput },
        { upload: sock.waUploadToServer }
      );

      const cardButtons = (item.buttons || []).map((btn) => normalizeButton(btn));

      carouselCards.push({
        header: proto.Message.InteractiveMessage.Header.fromObject({
          title: item.title || item.caption || '',
          hasMediaAttachment: true,
          ...media
        }),
        body: proto.Message.InteractiveMessage.Body.fromObject({
          text: item.body || ''
        }),
        footer: proto.Message.InteractiveMessage.Footer.fromObject({
          text: item.footer || footer
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
          buttons: cardButtons
        })
      });
    }

    const msg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
              body: { text },
              footer: { text: footer },
              carouselMessage: { cards: carouselCards }
            })
          }
        }
      },
      { userJid: sock.user?.id, quoted: quoted || options.quoted || null }
    );

    return sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  };

  sock.profilePictureUrl = async (jid, type = 'preview', timeoutMs = 5000) => {
    try {
      const result = await sock.query(
        {
          tag: 'iq',
          attrs: {
            target: jid,
            to: 's.whatsapp.net',
            type: 'get',
            xmlns: 'w:profile:picture'
          },
          content: [{ tag: 'picture', attrs: { type, query: 'url' } }]
        },
        timeoutMs
      );
      const child = getBinaryNodeChild(result, 'picture');
      return child?.attrs?.url || null;
    } catch {
      return null;
    }
  };

  return sock;
}

function resolveMedia(media) {
  if (!media) throw new Error('Media required');
  if (Buffer.isBuffer(media)) return media;
  if (typeof media === 'string') {
    if (media.startsWith('http://') || media.startsWith('https://')) return { url: media };
    return { url: media };
  }
  if (typeof media === 'object' && (media.url || media.buffer)) {
    if (media.buffer) return media.buffer;
    return media;
  }
  throw new Error('Media format tidak didukung');
}

/**
 * Normalize button definitions to Baileys native_flow format.
 */
function normalizeButton(btn = {}) {
  if (btn.name && btn.buttonParamsJson) {
    return {
      name: btn.name,
      buttonParamsJson:
        typeof btn.buttonParamsJson === 'string'
          ? btn.buttonParamsJson
          : JSON.stringify(btn.buttonParamsJson)
    };
  }

  const type = (btn.type || 'reply').toLowerCase();
  const label = btn.label || btn.displayText || btn.display_text || 'Button';
  const id = btn.id || '';

  switch (type) {
    case 'reply':
    case 'quick_reply':
      return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: label, id, ...(btn.options || {}) })
      };
    case 'url':
    case 'cta_url':
      return {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: label,
          url: btn.url || '',
          webview_interaction: !!btn.webview,
          ...(btn.options || {})
        })
      };
    case 'copy':
    case 'cta_copy':
      return {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: label,
          copy_code: btn.code || btn.copy_code || '',
          ...(btn.options || {})
        })
      };
    case 'call':
    case 'cta_call':
      return {
        name: 'cta_call',
        buttonParamsJson: JSON.stringify({
          display_text: label,
          id: id || btn.phone || '',
          ...(btn.options || {})
        })
      };
    case 'location':
    case 'send_location':
      return {
        name: 'send_location',
        buttonParamsJson: JSON.stringify(btn.options || {})
      };
    case 'address':
    case 'address_message':
      return {
        name: 'address_message',
        buttonParamsJson: JSON.stringify({
          display_text: label,
          id,
          ...(btn.options || {})
        })
      };
    case 'reminder':
    case 'cta_reminder':
      return {
        name: 'cta_reminder',
        buttonParamsJson: JSON.stringify({
          display_text: label,
          id,
          ...(btn.options || {})
        })
      };
    case 'cancel_reminder':
    case 'cta_cancel_reminder':
      return {
        name: 'cta_cancel_reminder',
        buttonParamsJson: JSON.stringify({
          display_text: label,
          id,
          ...(btn.options || {})
        })
      };
    case 'list':
    case 'single_select': {
      const sections = (btn.sections || []).map((section) => ({
        title: section.title || '',
        highlight_label: section.highlight_label || '',
        rows: (section.rows || []).map((row) => ({
          header: row.header || '',
          title: row.title || '',
          description: row.description || '',
          id: row.id || ''
        }))
      }));
      return {
        name: 'single_select',
        buttonParamsJson: JSON.stringify({
          title: label,
          sections
        })
      };
    }
    default:
      return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: label, id })
      };
  }
}

export default wrapSocket;
