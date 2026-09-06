# ZoraBot

A minimal, stable, multi-bot WhatsApp gateway base. Full ESM, built on
Baileys, with an isolated bot manager, a small modular plugin system, and a
clean dashboard.

## Cannot be run inside this sandbox

I wrote and syntax-checked every file, but this sandbox has **no network
access**, so I was not able to run `npm install` or actually boot the server
or connect a real WhatsApp session here. You'll need to do the first real
run yourself (see below) — please treat this as a solid first pass that
needs your own smoke test, not a package I've already verified end-to-end.

## Setup

```bash
npm install
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET to a long random string
npm start
```

Then open `http://localhost:3000`, create an account (the first account
becomes admin), create a bot, and click **Connect** to get a QR code.

## Architecture

```
src/
  config/        env config
  db/            single SQLite connection (WAL mode) + schema + repositories
  auth/          bcrypt password hashing, server-side sessions, ownership guard
  bots/          BotManager (Map<botId, BotInstance>) — full isolation per bot
  engine/        per-message context + concurrent, non-blocking message engine
  plugins/       ping.js, info.js, menu.js — drop new files here to add commands
  menu/          dynamic menu renderer driven by bot settings + enabled plugins
  api/           Express routes/middleware
public/          dashboard frontend (vanilla HTML/CSS/JS, no build step)
```

Key decisions, and why:

- **SQLite with a single WAL-mode connection**, not a traditional
  connection pool. SQLite is embedded/in-process, so "pooling" in the
  Postgres/MySQL sense doesn't apply — the equivalent correct pattern is one
  persistent connection with WAL journaling, which is what's here. No
  connection is opened per message.
- **No global socket, no global "currentChat" state.** `BotManager` holds
  one `BotInstance` per bot; each instance owns its own Baileys socket, auth
  folder, group-metadata cache, and reconnect timer. A crash or reconnect
  loop in one bot cannot touch another.
- **No message queue.** Each message from `messages.upsert` is dispatched as
  its own independent async task (fire-and-forget with its own try/catch),
  so a heavy command in one group can't delay a light command (`ping`,
  `menu`) in another group or bot. Per-message timing is logged
  (`queueWaitMs`, `pluginMs`, `sendMs`, `totalMs`) so regressions are
  measurable, not just assumed away.
- **Bounded reconnect backoff** (2s → 4s → 8s… capped at 60s), and the old
  socket's listeners are torn down before a new one is created — no
  duplicate sockets, no unbounded reconnect loop, no listener leaks.
- **Plugin errors are isolated** in the message engine: caught, logged
  server-side only (never a stack trace to the user), bot and other plugins
  keep running.
- **CSRF**: mitigated via `httpOnly` + `SameSite=Lax` session cookies and no
  CORS headers (so a cross-site page can't complete an authenticated JSON
  request), rather than a separate CSRF token system — appropriate for this
  base's scope. Add token-based CSRF later if you add authenticated
  cross-origin clients.
- **Auto-read / auto-presence** settings are wired to real Baileys calls
  (`readMessages`, `sendPresenceUpdate`), not decorative toggles — every
  control in the dashboard does something real, per your "no fake features"
  requirement.

## Adding a plugin

Drop a file in `src/plugins/`:

```js
export default {
  command: 'hello',
  aliases: [],
  category: 'General',
  description: 'Say hello',
  async run(ctx) {
    await ctx.reply('Hello!');
  }
};
```

Restart the server to load it (or extend `loadPlugins()` with a file
watcher if you want hot-reload — intentionally left out of the base).

## Testing checklist (map to your list)

Manual, since I couldn't run this here — go through these before calling it
done:

- [ ] Register + login, wrong password rejected, brute-force limit kicks in
- [ ] Create bot, connect, scan QR, status flips to Connected
- [ ] Disconnect, Reconnect
- [ ] Restart the server — session persists, bot reconnects without a new QR
- [ ] `ping`, `menu`, custom menu title/footer changes reflect immediately
- [ ] Edit bot name/prefix from dashboard — takes effect without restart
- [ ] Enable/disable a plugin — menu and command availability update
- [ ] Send many messages across several chats/groups at once — no backlog,
      no "silent then burst" pattern (watch the `totalMs`/`queueWaitMs` logs)
- [ ] Multiple bots connected simultaneously — one disconnecting doesn't
      affect the others
- [ ] Leave a bot idle for a long period, then send a message — no dead
      session, no forced re-auth
- [ ] Force a plugin to throw — bot stays up, user gets a generic error,
      no stack trace leaks
- [ ] Try to access another user's bot by id — 404, not data
