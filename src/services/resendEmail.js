import axios from 'axios'
import config from '../config/index.js'
import logger from '../utils/logger.js'

const RESEND_API_URL = 'https://api.resend.com/emails'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Builds the verification email HTML. Includes a styled button AND a plain
 * fallback link (as text), since some email clients strip button styling
 * or block button rendering entirely.
 */
function buildVerificationEmailHtml({ name, verifyUrl, ttlHours }) {
  const safeName = escapeHtml(name || '')
  const greeting = safeName ? `Hai ${safeName},` : 'Hai,'
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifikasi email</title>
</head>
<body style="margin:0;padding:0;background:#eef0f4;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(16,24,40,0.10);">
          <tr>
            <td style="padding:28px 32px 4px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#16191d;letter-spacing:-0.01em;">botenv</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 0;">
              <div style="width:56px;height:56px;border-radius:50%;background:rgba(37,99,235,0.1);margin:0 auto 20px;text-align:center;line-height:56px;">
                <span style="font-size:26px;line-height:56px;">✉️</span>
              </div>
              <h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;color:#16191d;text-align:center;">Verifikasi alamat email kamu</h1>
              <p style="margin:0 0 4px;font-size:14.5px;line-height:1.6;color:#3f4650;text-align:center;">${greeting}</p>
              <p style="margin:0 0 24px;font-size:14.5px;line-height:1.6;color:#3f4650;text-align:center;">
                Terima kasih sudah mendaftar. Klik tombol di bawah untuk memverifikasi alamat email dan mengaktifkan akunmu sepenuhnya.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px;text-align:center;">
              <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer"
                 style="display:inline-block;background:#1c1f24;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 32px;border-radius:12px;">
                Verifikasi Email
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 4px;">
              <p style="margin:0 0 6px;font-size:12.5px;color:#8a92a0;text-align:center;">
                Tombol tidak berfungsi? Salin dan tempel tautan berikut ke browser kamu:
              </p>
              <p style="margin:0;font-size:12.5px;text-align:center;word-break:break-all;">
                <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${verifyUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 28px;">
              <hr style="border:none;border-top:1px solid #ebedf1;margin:0 0 16px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#9aa1ac;text-align:center;">
                Tautan ini berlaku selama ${ttlHours} jam. Jika kamu tidak merasa mendaftar akun ini, abaikan saja email ini.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;font-size:11.5px;color:#9aa1ac;">© ${new Date().getFullYear()} botenv</p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Resolves the public base URL to use for links inside emails.
 * Priority: explicit APP_URL override > detected from the incoming request
 * (protocol + host, respecting X-Forwarded-* behind a proxy) > localhost.
 */
export function resolveBaseUrl(req) {
  if (config.email.appUrlOverride) return config.email.appUrlOverride
  if (req) {
    const host = req.get?.('host')
    if (host) return `${req.protocol}://${host}`
  }
  return `http://localhost:${config.port}`
}

/**
 * Sends a verification email via Resend. Returns true on success, false on
 * failure — never throws, so a down email provider never blocks registration.
 */
export async function sendVerificationEmail({ to, name, token, baseUrl }) {
  if (!config.email.resendApiKey) {
    logger.warn('RESEND_API_KEY not set — skipping verification email send')
    return false
  }
  const base = baseUrl || resolveBaseUrl()
  const verifyUrl = `${base}/verify-email?token=${encodeURIComponent(token)}`
  const html = buildVerificationEmailHtml({ name, verifyUrl, ttlHours: config.email.verifyTtlHours })

  try {
    await axios.post(
      RESEND_API_URL,
      {
        from: config.email.from,
        to: [to],
        subject: 'Verifikasi email kamu — botenv',
        html,
      },
      {
        headers: {
          Authorization: `Bearer ${config.email.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    )
    return true
  } catch (err) {
    logger.error(
      { err: err.response?.data || err.message },
      'Failed to send verification email via Resend'
    )
    return false
  }
}

export default { sendVerificationEmail, resolveBaseUrl }
