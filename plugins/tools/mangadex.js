import axios from 'axios'

const API = 'https://api.mangadex.org'

const searchManga = async (title) => {
    const { data } = await axios.get(`${API}/manga`, {
        params: {
            title,
            limit: 10,
            'includes[]': ['cover_art'],
            'order[relevance]': 'desc',
            'contentRating[]': ['safe', 'suggestive', 'erotica']
        }
    })
    return (data?.data || []).map(m => {
        const cover = m.relationships?.find(r => r.type === 'cover_art')?.attributes?.fileName
        return {
            id: m.id,
            title: m.attributes.title.en || Object.values(m.attributes.title)[0] || 'Unknown',
            status: m.attributes.status,
            year: m.attributes.year,
            desc: m.attributes.description.en || Object.values(m.attributes.description)[0] || '',
            tags: (m.attributes.tags || []).map(t => t.attributes.name.en).slice(0, 4),
            cover: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.256.jpg` : null
        }
    })
}

const getManga = async (mangaId) => {
    const { data } = await axios.get(`${API}/manga/${mangaId}`, { params: { 'includes[]': ['cover_art'] } })
    const m = data.data
    const cover = m.relationships?.find(r => r.type === 'cover_art')?.attributes?.fileName
    return {
        id: m.id,
        title: m.attributes.title.en || Object.values(m.attributes.title)[0] || 'Unknown',
        status: m.attributes.status,
        year: m.attributes.year,
        desc: m.attributes.description.en || Object.values(m.attributes.description)[0] || '',
        cover: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.512.jpg` : null
    }
}

const getAllChapters = async (mangaId) => {
    let offset = 0
    let all = []
    while (true) {
        const { data } = await axios.get(`${API}/manga/${mangaId}/feed`, {
            params: {
                limit: 500,
                offset,
                'order[chapter]': 'asc',
                'contentRating[]': ['safe', 'suggestive', 'erotica']
            }
        })
        all = all.concat(data?.data || [])
        if (!data?.data?.length || all.length >= (data?.total || 0)) break
        offset += 500
    }
    return all.map(c => ({
        id: c.id,
        chapter: c.attributes.chapter,
        title: c.attributes.title,
        lang: c.attributes.translatedLanguage
    }))
}

const getChapterPages = async (chapterId) => {
    const { data } = await axios.get(`${API}/at-home/server/${chapterId}`)
    const { baseUrl, chapter } = data
    return chapter.data.map(f => `${baseUrl}/data/${chapter.hash}/${f}`)
}

const __plugin =  {
    cmd: ['mangadex', 'mdx'],
    category: 'tools',
    run: async (m, { sock, text, config }) => {
        const args = text.trim().split(/\s+/)
        const sub = (args[0] || '').toLowerCase()
        const rest = args.slice(1)

        if (!text || sub === 'menu') {
            return sock.sendInteractiveButton(m.chat, {
                title: 'MangaDex',
                body: 'Cari manga, lalu tinggal tap tombol untuk lanjut ke detail, pilih bahasa, pilih chapter, sampai baca.',
                footer: config.botName,
                buttons: [
                    { type: 'reply', label: 'Contoh Cari', id: '.mangadex search oshi no ko' }
                ]
            }, { quoted: m })
        }

        if (sub === 'search') {
            const query = rest.join(' ')
            if (!query) return m.reply('Masukkan judul manga!\nContoh: .mangadex search oshi no ko')

            const results = await searchManga(query)
            if (!results.length) return m.reply(`Manga "${query}" tidak ditemukan.`)

            await sock.sendInteractiveButton(m.chat, {
                title: 'Hasil Pencarian',
                body: `Ditemukan ${results.length} manga untuk "${query}".\nTap salah satu untuk lihat detail.`,
                footer: config.botName,
                buttons: [{
                    type: 'list', label: `Pilih Manga (${results.length})`,
                    sections: [{
                        title: 'Hasil Pencarian',
                        rows: results.map(r => ({
                            title: r.title.length > 60 ? r.title.slice(0, 57) + '...' : r.title,
                            description: `${r.status || '-'}${r.year ? ` - ${r.year}` : ''} - ${r.tags.join(', ') || '-'}`,
                            id: `.mangadex detail ${r.id}`
                        }))
                    }]
                }]
            }, { quoted: m })
            return
        }

        if (sub === 'detail') {
            const mangaId = rest[0]
            if (!mangaId) return m.reply('Manga ID kosong. Cari dulu: .mangadex search <judul>')

            const [manga, chapters] = await Promise.all([getManga(mangaId), getAllChapters(mangaId)])
            if (!chapters.length) return m.reply('Belum ada chapter untuk manga ini.')

            const perLang = {}
            for (const c of chapters) perLang[c.lang] = (perLang[c.lang] || 0) + 1
            const langs = Object.entries(perLang).sort((a, b) => b[1] - a[1])

            const caption = [
                `${manga.title}`,
                ``,
                manga.desc ? manga.desc.slice(0, 350) + (manga.desc.length > 350 ? '...' : '') : '-',
                ``,
                `Status: ${manga.status || '-'}${manga.year ? ` - ${manga.year}` : ''}`,
                `Total chapter: ${chapters.length}`,
                ``,
                `Pilih bahasa untuk lihat daftar chapter.`
            ].join('\n')

            await sock.sendInteractiveButton(m.chat, {
                image: manga.cover || undefined,
                title: 'Detail Manga',
                body: caption,
                footer: config.botName,
                buttons: [{
                    type: 'list', label: `Pilih Bahasa (${langs.length})`,
                    sections: [{
                        title: 'Bahasa Tersedia',
                        rows: langs.map(([lang, count]) => ({
                            title: lang,
                            description: `${count} chapter`,
                            id: `.mangadex chapters ${mangaId} ${lang}`
                        }))
                    }]
                }]
            }, { quoted: m })
            return
        }

        if (sub === 'chapters') {
            const mangaId = rest[0]
            const lang = rest[1]
            const page = parseInt(rest[2]) || 1
            if (!mangaId || !lang) return m.reply('Format salah. Ulangi dari: .mangadex search <judul>')

            const chapters = (await getAllChapters(mangaId)).filter(c => c.lang === lang)
            if (!chapters.length) return m.reply(`Tidak ada chapter berbahasa "${lang}".`)

            const PAGE_SIZE = 40
            const totalPages = Math.ceil(chapters.length / PAGE_SIZE)
            const pageItems = chapters.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

            const sections = []
            for (let i = 0; i < pageItems.length; i += 10) {
                const chunk = pageItems.slice(i, i + 10)
                const startNo = (page - 1) * PAGE_SIZE + i + 1
                sections.push({
                    title: `Ch. ${startNo}-${startNo + chunk.length - 1}`,
                    rows: chunk.map(c => ({
                        title: `Ch.${c.chapter || '?'}${c.title ? ` - ${c.title.slice(0, 35)}` : ''}`,
                        description: c.lang,
                        id: `.mangadex baca ${mangaId} ${c.id}`
                    }))
                })
            }
            if (page < totalPages) {
                sections.push({
                    title: 'Navigasi',
                    rows: [{
                        title: 'Halaman Berikutnya',
                        description: `Halaman ${page + 1} dari ${totalPages}`,
                        id: `.mangadex chapters ${mangaId} ${lang} ${page + 1}`
                    }]
                })
            }

            await sock.sendInteractiveButton(m.chat, {
                title: 'Daftar Chapter',
                body: `${lang} - ${chapters.length} chapter (halaman ${page}/${totalPages})\nTap chapter untuk langsung baca.`,
                footer: config.botName,
                buttons: [{
                    type: 'list', label: 'Pilih Chapter',
                    sections
                }]
            }, { quoted: m })
            return
        }

        if (sub === 'baca') {
            const mangaId = rest[0]
            const chapterId = rest[1]
            if (!mangaId || !chapterId) return m.reply('Format salah. Ulangi dari: .mangadex search <judul>')

            const [manga, pages] = await Promise.all([getManga(mangaId), getChapterPages(chapterId)])
            if (!pages.length) return m.reply('Halaman kosong / chapter tidak tersedia.')

            await m.reply(`${manga.title}\n${pages.length} halaman\nMengirim...`)

            const album = pages.map(url => ({ image: { url } }))
            for (let i = 0; i < album.length; i += 30) {
                await sock.sendAlbum(m.chat, album.slice(i, i + 30), { quoted: m })
            }
            return
        }

        return m.reply('Perintah tidak dikenali. Ketik .mangadex untuk mulai.')
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

handler.command = __plugin.cmd || ['mangadex', 'mdx']
handler.help = __plugin.help || __plugin.cmd || ['mangadex', 'mdx']
handler.tags = [__plugin.category || 'tools']

export default handler
