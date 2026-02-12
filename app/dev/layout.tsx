import { redirect } from 'next/navigation';

export default async function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TODO: revert — temporarily disabled for prod testing
  if (false && process.env.NODE_ENV === 'production') {
    redirect('/');
  }

  return <>{children}</>;
}
