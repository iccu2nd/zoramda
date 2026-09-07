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
# wajib: MONGODB_URI, MONGODB_DB_NAME, ADMIN_API_KEY, API_SECRET, JWT_SECRET
# prefix / owner / nama bot → diubah via API atau .set (tidak perlu di .env)

npm install
npm start
```

Health check: `GET /health`

## API

All session endpoints require header:

```
x-api-key: <your-api-key>
```

Admin key is set via `ADMIN_API_KEY` in `.env`.

### Create user (admin only)

```
POST /api/auth/users
{ "name": "user1" }
→ { userId, apiKey, role }
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

Settings disimpan di MongoDB dan bisa diubah tanpa restart.

### API

```
GET  /api/config          # lihat config (public fields / full jika admin)
PUT  /api/config          # update (admin only)
PATCH /api/config         # partial update (admin only)
GET  /api/config/schema   # schema field untuk form frontend
POST /api/config/refresh  # reload dari DB
```

Contoh update:

```bash
curl -X PATCH http://localhost:3000/api/config \
  -H "x-api-key: <ADMIN_API_KEY>" \
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
