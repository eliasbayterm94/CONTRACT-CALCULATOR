import type { Metadata } from 'next';
import AppShell from '@/components/shell/AppShell';
import { currentAdmin } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'Forest Quote Desk',
  description: 'KC-linked contract quoting for Forest Coffee.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Montserrat:wght@300;400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <AppShell admin={admin}>{children}</AppShell>
      </body>
    </html>
  );
}
