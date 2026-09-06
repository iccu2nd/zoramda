/**
 * Demo plugin for media helpers.
 * Commands: button, album (info only), sticker usage via reply in other plugins.
 */
export default {
  command: 'button',
  aliases: ['btn'],
  category: 'tools',
  description: 'Contoh tombol interaktif',
  async run({ sendButton, reply }) {
    try {
      await sendButton({
        text: 'ZoraBot Button Demo',
        footer: 'Pilih salah satu',
        buttons: [
          { type: 'reply', label: 'Ping', id: '.ping' },
          { type: 'url', label: 'GitHub', url: 'https://github.com' },
          { type: 'copy', label: 'Salin Kode', code: 'ZORABOT' }
        ]
      });
    } catch (err) {
      await reply('Gagal kirim button: ' + (err.message || 'unknown'));
    }
  }
};
