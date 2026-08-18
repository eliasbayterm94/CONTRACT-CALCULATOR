import type { Metadata } from 'next';
import Link from 'next/link';
import { currentAdmin } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'Forest Contract Calculator',
  description: 'KC-linked contract quoting for Forest Coffee.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  return (
    <html lang="en">
      <body>
        <header className="border-b" style={{ background: 'var(--surface)' }}>
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
            <Link href="/" className="text-[0.9375rem] font-bold tracking-tight">
              Forest <span style={{ color: 'var(--accent)' }}>Contract Calculator</span>
            </Link>
            <nav className="flex items-center gap-4 text-[0.8125rem]">
              <Link href="/" className="hover:underline">
                Quote
              </Link>
              <Link href="/quotes" className="hover:underline">
                History
              </Link>
              <Link href="/admin" className="hover:underline">
                Admin
              </Link>
            </nav>
            <div className="ml-auto text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
              {admin ? `Signed in as ${admin}` : 'Read-only — sign in to edit rates'}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
