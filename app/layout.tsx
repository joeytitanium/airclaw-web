import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AirClaw',
  description: 'Your personal AI assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
