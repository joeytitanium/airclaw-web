import { auth } from '@/lib/auth';
import { getRouteUrl } from '@/routing/get-route-url';
import { redirect } from 'next/navigation';

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect(getRouteUrl({ to: '/auth/signin' }));
  }

  return <>{children}</>;
}
