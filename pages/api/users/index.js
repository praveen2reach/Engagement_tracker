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

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC`;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { name, email, role } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    const finalRole = role === 'admin' ? 'admin' : 'team';
    const tempPassword = randomTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    try {
      const { rows } = await sql`
        INSERT INTO users (name, email, password_hash, role)
        VALUES (${name}, ${email}, ${hash}, ${finalRole})
        RETURNING id, name, email, role, created_at
      `;
      return res.status(201).json({ user: rows[0], temp_password: tempPassword });
    } catch (err) {
      if (String(err.message).includes('duplicate') || err.code === '23505') {
        return res.status(409).json({ error: 'A user with that email already exists.' });
      }
      throw err;
    }
  }

  return res.status(405).end();
}
