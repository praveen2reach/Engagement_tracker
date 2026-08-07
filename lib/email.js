// lib/email.js
const { Resend } = require('resend');

async function sendDigestEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not set');
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.ALERT_FROM_EMAIL || 'onboarding@resend.dev';
  return resend.emails.send({ from, to, subject, html });
}

module.exports = { sendDigestEmail };
