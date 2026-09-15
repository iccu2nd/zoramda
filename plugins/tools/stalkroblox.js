import axios from 'axios'

const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
}

async function stalkRoblox(username) {
    const userRes = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [username] }, { headers })
    const userData = userRes.data?.data?.[0]
    if (!userData) throw new Error('Username tidak ditemukan')

    const id = userData.id

    const getUser = () => axios.get(`https://users.roblox.com/v1/users/${id}`, { headers }).then(r => r.data).catch(() => ({}))
    const getAvatar = () => axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${id}&size=720x720&format=Png&isCircular=false`, { headers }).then(r => r.data?.data?.[0]?.imageUrl || null).catch(() => null)
    const getPresence = () => axios.post('https://presence.roblox.com/v1/presence/users', { userIds: [id] }, { headers }).then(r => {
        const p = r.data?.userPresences?.[0] || {}
        return { isOnline: p.userPresenceType === 2, lastOnline: p.lastOnline || '-', location: p.lastLocation || 'Offline' }
    }).catch(() => ({ isOnline: false, lastOnline: '-', location: 'Offline' }))
    const getFriends = () => axios.get(`https://friends.roblox.com/v1/users/${id}/friends/count`, { headers }).then(r => r.data?.count || 0).catch(() => 0)
    const getFollowers = () => axios.get(`https://friends.roblox.com/v1/users/${id}/followers/count`, { headers }).then(r => r.data?.count || 0).catch(() => 0)
    const getFollowing = () => axios.get(`https://friends.roblox.com/v1/users/${id}/followings/count`, { headers }).then(r => r.data?.count || 0).catch(() => 0)
    const getBadges = () => axios.get(`https://badges.roblox.com/v1/users/${id}/badges?limit=10&sortOrder=Desc`, { headers }).then(r => r.data?.data?.map(b => b.name) || []).catch(() => [])

    const [user, avatar, presence, friends, followers, following, badges] = await Promise.all([
        getUser(), getAvatar(), getPresence(), getFriends(), getFollowers(), getFollowing(), getBadges()
    ])

    return {
        username: user.name || username,
        displayName: user.displayName || '-',
        description: user.description || '-',
        created: user.created || '-',
        verified: user.hasVerifiedBadge || false,
        avatar,
        online: presence.isOnline,
        lastOnline: presence.lastOnline,
        location: presence.location,
        friends,
        followers,
        following,
        badges
    }
}

const __plugin =  {
    cmd: ['stalkroblox', 'robloxstalk'],
    category: 'tools',
    run: async (m, { sock, text }) => {
        if (!text) return m.reply('Masukkan username Roblox.\nContoh: .stalkroblox pragrowxd')

        await m.reply('Mencari...')
        try {
            const data = await stalkRoblox(text.trim())

            const caption = `*Stalk Roblox - @${data.username}*\n\n` +
                `Nama: ${data.displayName}\n` +
                `Deskripsi: ${data.description}\n` +
                `Dibuat: ${new Date(data.created).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n` +
                `Terverifikasi: ${data.verified ? 'Ya' : 'Tidak'}\n\n` +
                `Online: ${data.online ? 'Ya' : 'Tidak'}\n` +
                `Terakhir Online: ${data.lastOnline}\n` +
                `Lokasi: ${data.location}\n\n` +
                `Teman: ${data.friends}\n` +
                `Followers: ${data.followers}\n` +
                `Following: ${data.following}\n` +
                (data.badges.length > 0 ? `\nBadges: ${data.badges.join(', ')}` : '')

            if (data.avatar) {
                const imgRes = await axios.get(data.avatar, {
                    responseType: 'arraybuffer',
                    timeout: 15000
                })
                const buffer = Buffer.from(imgRes.data)
                await sock.sendMessage(m.chat, {
                    image: buffer,
                    caption
                }, { quoted: m })
            } else {
                await sock.sendMessage(m.chat, { text: caption }, { quoted: m })
            }

        } catch (e) {
            m.reply(`Error: ${e.message}`)
            throw e
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
    sock, conn, text, args, prefix, usedPrefix, command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin, cmd: command,
  })
}

handler.command = __plugin.cmd || ['stalkroblox', 'robloxstalk']
handler.help = __plugin.help || __plugin.cmd || ['stalkroblox', 'robloxstalk']
handler.tags = [__plugin.category || 'tools']

export default handler
