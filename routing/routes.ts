export type Route =
  | { to: '/'; params?: never; fragment?: never }
  | { to: '/auth/signin'; params?: { callbackUrl?: string }; fragment?: never }
  | { to: '/chat'; params?: never; fragment?: never }
  | { to: '/dummy'; params?: never; fragment?: 'foo' }; // TODO: Remove later
