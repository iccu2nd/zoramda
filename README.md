# ZoraBot

Production-ready multi-session WhatsApp Gateway / Bot Engine.

- **Node.js LTS** + ESM
- **Baileys** (stable)
- **MongoDB** for session auth + metadata
- Plugin system with hot-reload
- Multi-session isolated
- Low-latency message pipeline
- REST API for session management
- Portable: Railway / VPS / Docker / any Node host

## Quick Start

```bash
cp .env.example .env
# wajib: MONGODB_URI, MONGODB_DB_NAME, JWT_SECRET
# ADMIN_API_KEY opsional — hanya untuk operator/tooling, tidak dipakai user biasa

npm install
npm start
```

Health check: `GET /health`

## Auth

Setiap orang bisa daftar akun sendiri lewat dashboard (`/app`) atau API — **tidak perlu api key admin**.
Login pakai username + password, dapat session token (JWT) yang dipakai dashboard secara otomatis.

```
POST /api/auth/register   { username, password, name? }  → { token, user }
POST /api/auth/login      { username, password }          → { token, user }
GET  /api/auth/me                                          → profil + apiKey milik sendiri
POST /api/auth/apikey/rotate                                → generate apiKey baru
```

Endpoint session/config/plugin lainnya menerima salah satu dari:

```
Authorization: Bearer <token>   # dari login — dipakai dashboard
x-api-key: <apiKey>             # akses programatik, apiKey didapat dari akun sendiri
```

Setiap akun punya session, config bot, dan override respons plugin masing-masing — sepenuhnya terpisah antar user.

### Create user (admin only, opsional)

```
POST /api/auth/users
{ "username": "user1", "password": "...", "name": "user1" }
→ { userId, username, apiKey, role }
```

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sessions | List own sessions |
| POST | /api/sessions | Create session |
| GET | /api/sessions/:id | Status / detail |
| GET | /api/sessions/:id/qr | QR data URL |
| GET | /api/sessions/:id/pairing | Pairing code |
| POST | /api/sessions/:id/connect | Start / reconnect |
| POST | /api/sessions/:id/disconnect | Disconnect |
| DELETE | /api/sessions/:id | Delete + logout |

Body for create / connect (optional):

```json
{ "name": "My Bot", "pairingPhone": "628xxxxxxxxxx" }
```

## Plugins

Put files under `plugins/<category>/*.js`:

```js
let handler = async (m, { conn, text, usedPrefix, command }) => {
  await conn.reply(m.chat, 'Pong!', m)
}

handler.help = ['ping']
handler.tags = ['main']
handler.command = ['ping']

export default handler
```

Hot-reload is automatic when files change.

## Docker

```bash
docker build -t zorabot .
docker run -p 3000:3000 --env-file .env zorabot
```

## Architecture Notes

- No global message queue – each session processes independently
- Background init (group sync, heavy tasks) never blocks first `.menu`
- Auth state stored in MongoDB (ephemeral filesystem safe)
- Reconnect uses exponential backoff per session only
- One plugin error does not crash the process or other plugins

## License

MIT


## Bot Config (Editable via API / WhatsApp)

Settings disimpan di MongoDB **per akun** dan bisa diubah tanpa restart — config milikmu tidak memengaruhi user lain.

### API

```
GET  /api/config          # lihat config milik akun yang login
PUT  /api/config          # update config sendiri
PATCH /api/config         # partial update config sendiri
GET  /api/config/schema   # schema field untuk form frontend
POST /api/config/refresh  # reload dari DB
```

Contoh update:

```bash
curl -X PATCH http://localhost:3000/api/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "botName": "MyBot",
    "prefix": "!",
    "ownerNumbers": ["6281234567890"],
    "publicMode": true,
    "menuTitle": "Menu Bot Saya"
  }'
```

### Dari WhatsApp (owner)

```
.set botName MyBot
.set prefix !
.set publicMode false
.set ownerNumbers 628xxx,628yyy
.set
```

Field yang bisa diubah:
- botName, botNumber, ownerName, ownerNumbers
- prefix, publicMode, antiSpam, antiSpamCooldownMs
- menuTitle, welcomeMessage, ownerOnlyMessage
- maintenanceMode, maintenanceMessage
- maxSessionsPerUser, extra

## Plugin Responses (Editable via Dashboard)

Plugin bisa mendeklarasikan teks balasan yang boleh diubah lewat `handler.responses = { key: 'default text' }`.
Setiap akun bisa override teks itu untuk bot-nya sendiri, tanpa menyentuh kode plugin — lewat dashboard (menu hamburger → *plugins*) atau API:

```
GET   /api/plugins                       # daftar plugin + respons (default & override milik sendiri)
PATCH /api/plugins/:command/responses    # update override, kirim value kosong untuk reset ke default
```

Placeholder seperti `{botName}`, `{prefix}`, `{ownerName}` di teks akan otomatis diganti saat bot membalas.
