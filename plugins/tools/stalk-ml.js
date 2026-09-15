import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://sosigame.com';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

let csrfToken = '';
let cookies = '';

async function getCSRF() {
  const response = await axios.get(`${BASE_URL}/topup/mobile-legends`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
    }
  });

  if (response.headers['set-cookie']) {
    cookies = response.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  }

  const html = response.data;
  const $ = cheerio.load(html);
  
  let token = $('meta[name="_token"]').attr('content');
  
  if (!token) {
    token = $('input[name="_token"]').val();
  }

  if (!token) {
    const match = html.match(/name="_token"\s+content="([^"]+)"/i);
    if (match) token = match[1];
  }

  if (!token && cookies) {
    const match = cookies.match(/XSRF-TOKEN=([^;]+)/i);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) throw new Error('Gagal mendapatkan CSRF token');

  csrfToken = token;
  return token;
}

async function checkUser(userId, serverId) {
  if (!csrfToken) await getCSRF();

  const postData = new URLSearchParams();
  postData.append('game_code', '1');
  postData.append('user_id', userId);
  postData.append('server_id', serverId);

  const response = await axios.post(`${BASE_URL}/ajax_cek_username`, postData.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrfToken,
      'Cookie': cookies,
      'Referer': `${BASE_URL}/topup/mobile-legends`,
      'Origin': BASE_URL,
    }
  });

  return response.data;
}

async function stalkML(userId, serverId) {
  const result = await checkUser(userId, serverId);
  
  if (!result.valid) {
    throw new Error(result.message || 'ID atau Server tidak valid');
  }

  return {
    id: userId,
    server: serverId,
    username: result.username,
    region: result.region,
    isIndonesia: result.is_indonesia
  };
}

const __plugin =  {
  cmd: ['ml', 'stalkml', 'mobilelegends'],
  category: 'game',
  description: 'Stalk akun Mobile Legends',
  run: async (m, { text }) => {
    if (!text) {
      return m.reply(
        'Stalk Mobile Legends\n\n' +
        'Usage:\n' +
        '.ml <user_id> <server_id>\n\n' +
        'Contoh:\n' +
        '.ml 651321779 85'
      );
    }

    const args = text.trim().split(/\s+/);
    const userId = args[0];
    const serverId = args[1] || '';

    if (!userId || !serverId) {
      return m.reply('Masukkan ID dan Server!\nContoh: .ml 651321779 85');
    }

    try {
      await m.reply('Mencari data akun...');
      const result = await stalkML(userId, serverId);
      
      let msg = 'Mobile Legends Stalker\n\n';
      msg += `ID: ${result.id}\n`;
      msg += `Server: ${result.server}\n`;
      msg += `Username: ${result.username}\n`;
      msg += `Region: ${result.region || 'Tidak diketahui'}\n`;
      msg += `Indonesia: ${result.isIndonesia ? 'Ya' : 'Tidak'}\n`;
      
      return m.reply(msg);
    } catch (error) {
      return m.reply(`Error: ${error.message}`);
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

handler.command = __plugin.cmd || ['ml', 'stalkml', 'mobilelegends']
handler.help = __plugin.help || __plugin.cmd || ['ml', 'stalkml', 'mobilelegends']
handler.tags = [__plugin.category || 'game']

export default handler
