import type { Metadata } from 'next';
import AppShell from '@/components/shell/AppShell';
import { viewingAsTrader } from '@/lib/auth';
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
  // There is no sign-in: whoever is here is the desk. The preview is the only
  // thing that changes what the shell draws.
  const asTrader = await viewingAsTrader();
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
        <AppShell previewing={asTrader}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
