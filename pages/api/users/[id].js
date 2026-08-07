import { getServerSession } from 'next-auth/next';
const { authOptions } = require('../../../lib/auth');
const { sql } = require('../../../lib/db');
const bcrypt = require('bcryptjs');

function randomTempPassword() {
  return Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-6);
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  if (session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (req.method !== 'PATCH') return res.status(405).end();

  const { id } = req.query;
  const { role, reset_password } = req.body;

  if (role) {
    await sql`UPDATE users SET role = ${role === 'admin' ? 'admin' : 'team'} WHERE id = ${id}`;
  }

  let tempPassword;
  if (reset_password) {
    tempPassword = randomTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${id}`;
  }

  return res.status(200).json({ ok: true, temp_password: tempPassword || null });
}
