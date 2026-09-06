# ZoraBot

Stable WhatsApp Gateway Base — multi-bot, isolated sessions, modular plugins.

## Requirements

- Node.js >= 20
- `ffmpeg` di PATH (untuk voice note & convert sticker)

## Install

```bash
cd zorabot
npm install
```

## Run

```bash
npm start
```

Open `http://localhost:3000`

## Structure

```
src/
  index.js
  config/
  db/
  bot/
    manager.js
    session.js
    messageEngine.js
    pluginLoader.js
    socketHelpers.js   # button, album, sticker, vn, …
    media.js
    groupCache.js
  plugins/
  server/
  middleware/
  utils/
public/
sessions/
data/
```

## Base Commands

| Command | Description |
|---------|-------------|
| `.ping` | Latency check |
| `.menu` | Dynamic menu from active plugins |
| `.info` | Bot info |
| `.button` | Demo interactive buttons |

## Media helpers (plugin context)

Setiap plugin menerima:

| Helper | Keterangan |
|--------|------------|
| `reply(text)` | Teks biasa |
| `sendImage(media, caption?)` | Gambar |
| `sendVideo(media, caption?, { gif })` | Video |
| `sendAudio(media, { ptt })` | Audio |
| `sendVN(media)` | Voice note (opus) |
| `sendSticker(media, opts)` | Sticker + EXIF |
| `sendAlbum(items)` | Album multi media |
| `sendButton(content)` | Native flow buttons |
| `sendButtonV2(content)` | Legacy buttons |
| `sendCarousel(content)` | Carousel cards |

### Button types

`reply`, `url`, `copy`, `call`, `location`, `address`, `reminder`, `cancel_reminder`, `list`

```js
await sendButton({
  text: 'Pilih',
  footer: 'ZoraBot',
  buttons: [
    { type: 'reply', label: 'OK', id: '.ping' },
    { type: 'url', label: 'Web', url: 'https://example.com' },
    { type: 'copy', label: 'Salin', code: 'ABC123' },
    {
      type: 'list',
      label: 'Menu',
      sections: [{
        title: 'Main',
        rows: [
          { title: 'Ping', id: '.ping' },
          { title: 'Info', id: '.info' }
        ]
      }]
    }
  ]
})
```

### Album

```js
await sendAlbum([
  { image: { url: 'https://example.com/1.jpg' } },
  { image: { url: 'https://example.com/2.jpg' } }
])
```

### Sticker / VN

```js
await sendSticker(bufferOrUrl, { packname: 'Zora', author: 'Bot' })
await sendVN(audioBufferOrUrl)
```

## Design Principles

- One bot = one isolated socket + auth + handlers
- No global message queue / lock
- Plugin errors never crash other bots
- Session persistence across reconnect & restart
- Settings (name, prefix, menu, plugins) live in DB

## Security

- bcrypt password hashing
- httpOnly session cookie
- Ownership checks on every bot endpoint
- No stack traces / secrets to client
- Rate limit on auth endpoints
