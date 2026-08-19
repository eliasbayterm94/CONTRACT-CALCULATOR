'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const ChartIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path d="M3 3v18h18" />
    <path d="m7 14 4-4 3 3 5-6" />
  </svg>
);
const LayersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path d="M3 6h18M3 12h18M3 18h18" />
    <path d="M8 3v18" />
  </svg>
);
const SlidersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

const TRADING: NavItem[] = [
  { href: '/', label: 'New quote', icon: ChartIcon },
  { href: '/multi', label: 'Multi-shipment', icon: LayersIcon, adminOnly: true },
];

const ADMIN: NavItem[] = [{ href: '/admin', label: 'Rates & costs', icon: SlidersIcon }];

export default function AppShell({
  admin,
  children,
}: {
  admin: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A tap that navigates should also put the drawer away.
  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const visible = (items: NavItem[]) => items.filter((i) => !i.adminOnly || admin);
  const title = [...TRADING, ...ADMIN].find((i) => i.href === pathname)?.label ?? 'Quote desk';

  return (
    <div className="fc-app">
      <div
        className={`fc-sidebar-backdrop${drawerOpen ? ' open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      <aside className={`fc-sidebar${drawerOpen ? ' open' : ''}`}>
        <div className="fc-sidebar-header">
          <div className="fc-sidebar-brand" style={{ cursor: 'default' }}>
            <div className="fc-sidebar-logo">F</div>
            <div className="fc-sidebar-title">Quote&nbsp;Desk</div>
          </div>
          <button
            type="button"
            className="qc-drawer-close"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="fc-sidebar-nav">
          <div className="fc-sidebar-section">
            <div className="fc-sidebar-section-label">Trading</div>
            {visible(TRADING).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className={`fc-sidebar-link${pathname === item.href ? ' active' : ''}`}
              >
                {item.icon}
                <span className="label">{item.label}</span>
              </Link>
            ))}
          </div>
          {admin && (
            <div className="fc-sidebar-section">
              <div className="fc-sidebar-section-label">Admin</div>
              {ADMIN.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  className={`fc-sidebar-link${pathname === item.href ? ' active' : ''}`}
                >
                  {item.icon}
                  <span className="label">{item.label}</span>
                </Link>
              ))}
            </div>
          )}
          {!admin && (
            <div className="fc-sidebar-section">
              <div className="fc-sidebar-section-label">Admin</div>
              <Link href="/admin" prefetch className="fc-sidebar-link">
                {SlidersIcon}
                <span className="label">Sign in</span>
              </Link>
            </div>
          )}
        </nav>
      </aside>

      <div className="fc-app-main">
        <header className="fc-topbar">
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <button
              type="button"
              className="fc-mobile-toggle"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="fc-topbar-page-title">{title}</span>
          </div>
          <div className="qc-topbar-right">
            <span className={`qc-whoami${admin ? ' is-admin' : ''}`}>
              <span className="qc-dot" />
              <span className="qc-name">{admin ? `${admin} · Admin` : 'Trading'}</span>
            </span>
          </div>
        </header>

        <div className="fc-content">{children}</div>

        <nav className="fc-bottom-nav">
          <div className="fc-bottom-nav-inner">
            {[...visible(TRADING), ADMIN[0]].slice(0, 4).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className={`fc-bottom-nav-btn${pathname === item.href ? ' active' : ''}`}
              >
                {item.icon}
                {item.label.split(' ')[0]}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
