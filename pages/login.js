import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await signIn('credentials', { redirect: false, email, password });
    setLoading(false);
    if (res?.error) {
      setError('Incorrect email or password.');
    } else {
      router.push('/');
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <h1>Engagement Task Tracker</h1>
        <p className="subtle">Sign in to view or update the plan.</p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, textTransform: 'uppercase', color: '#7c8aa0', display: 'block', marginBottom: 4 }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, textTransform: 'uppercase', color: '#7c8aa0', display: 'block', marginBottom: 4 }}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>
        <p className="subtle" style={{ marginTop: 16 }}>
          Company SSO coming soon — this is a Phase 1 login while IT provisions app access.
        </p>
      </div>
    </div>
  );
}
