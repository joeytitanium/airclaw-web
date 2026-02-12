'use client';

import { getRouteUrl } from '@/routing/get-route-url';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

const providers = [{ id: 'google', name: 'Google' }];

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl =
    searchParams.get('callbackUrl') || getRouteUrl({ to: '/chat' });
  const error = searchParams.get('error');
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui',
        maxWidth: 400,
        margin: '0 auto',
      }}
    >
      <h1>Sign in</h1>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        Choose a provider to continue.
      </p>

      {error && (
        <p
          style={{
            color: '#c00',
            background: '#fff0f0',
            padding: '0.75rem',
            borderRadius: 4,
            marginBottom: '1rem',
            fontSize: '0.875rem',
          }}
        >
          {error === 'OAuthAccountNotLinked'
            ? 'This email is already associated with another provider.'
            : 'Something went wrong. Please try again.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            disabled={loadingProvider !== null}
            onClick={() => {
              setLoadingProvider(provider.id);
              signIn(provider.id, { callbackUrl });
            }}
            style={{
              width: '100%',
              padding: '0.625rem',
              fontSize: '1rem',
              background: '#000',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loadingProvider ? 'wait' : 'pointer',
              opacity:
                loadingProvider && loadingProvider !== provider.id ? 0.5 : 1,
            }}
          >
            {loadingProvider === provider.id
              ? 'Redirecting...'
              : `Continue with ${provider.name}`}
          </button>
        ))}
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
