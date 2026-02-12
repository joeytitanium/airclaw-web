'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const errorMessages: Record<string, string> = {
  Configuration: 'There is a problem with the server configuration.',
  AccessDenied: 'Access denied. You do not have permission to sign in.',
  Verification: 'The verification link has expired or has already been used.',
  OAuthSignin: 'Could not start the sign-in process. Please try again.',
  OAuthCallback: 'Could not complete the sign-in process. Please try again.',
  OAuthAccountNotLinked:
    'This email is already associated with another provider. Sign in with the original provider.',
  Default: 'Something went wrong. Please try again.',
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || 'Default';
  const message = errorMessages[error] || errorMessages.Default;

  return (
    <main
      style={{
        padding: '2rem',
        fontFamily: 'system-ui',
        maxWidth: 400,
        margin: '0 auto',
      }}
    >
      <h1>Sign-in error</h1>
      <p
        style={{
          color: '#c00',
          background: '#fff0f0',
          padding: '0.75rem',
          borderRadius: 4,
          marginBottom: '1.5rem',
          fontSize: '0.875rem',
        }}
      >
        {message}
      </p>
      <a
        href="/auth/signin"
        style={{
          display: 'inline-block',
          padding: '0.5rem 1rem',
          fontSize: '1rem',
          background: '#000',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          textDecoration: 'none',
        }}
      >
        Try again
      </a>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
