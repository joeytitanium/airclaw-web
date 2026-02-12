'use client';

import { getRouteUrl } from '@/routing/get-route-url';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function DevLoginPage() {
  const [email, setEmail] = useState('dev@test.com');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await signIn('credentials', {
      email,
      callbackUrl: getRouteUrl({ to: '/chat' }),
    });
  }

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui',
        maxWidth: 400,
        margin: '0 auto',
      }}
    >
      <h1>Dev Login</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        Development-only auth bypass. Enter any email to create a test user.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="dev@test.com"
          required
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: 4,
            marginBottom: '1rem',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            background: '#000',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
