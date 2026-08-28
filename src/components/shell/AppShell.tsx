'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { setTraderView } from '@/app/actions';

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

const GridIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);

const TRADING: NavItem[] = [
  { href: '/', label: 'New quote', icon: ChartIcon },
  { href: '/board', label: 'Price board', icon: GridIcon },
  { href: '/multi', label: 'Multi-shipment', icon: LayersIcon, adminOnly: true },
];

const ADMIN: NavItem[] = [{ href: '/admin', label: 'Rates & costs', icon: SlidersIcon }];

export default function AppShell({
  previewing,
  children,
}: {
  /** True while the desk is looking at its own screens as a trader would. */
  previewing: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switching, startSwitch] = useTransition();

  // A tap that navigates should also put the drawer away.
  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const visible = (items: NavItem[]) => items.filter((i) => !i.adminOnly || !previewing);
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
          {!previewing && (
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
            <button
                type="button"
                className={`qc-viewtoggle${previewing ? ' is-on' : ''}`}
                aria-pressed={previewing}
                disabled={switching}
                onClick={() => startSwitch(() => { void setTraderView(!previewing); })}
                title={previewing ? 'Back to the admin view' : 'See the desk as a trader does'}
              >
                <span className="qc-viewtoggle-track"><span className="qc-viewtoggle-knob" /></span>
              <span className="qc-viewtoggle-label">Trader view</span>
            </button>
            <span className={`qc-whoami${previewing ? '' : ' is-admin'}`}>
              <span className="qc-dot" />
              <span className="qc-name">{previewing ? 'Trading' : 'Desk'}</span>
            </span>
          </div>
        </header>

        {previewing && (
          <div className="qc-preview-bar" role="status">
            <span className="qc-preview-eye" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span>
              Trader view — costs, margins and the admin screens are hidden, exactly as a client-facing
              screen shows them. <strong>Nothing is locked</strong>: turn it off to get everything back.
            </span>
            <button
              type="button"
              className="fc-btn fc-btn-ghost"
              disabled={switching}
              onClick={() => startSwitch(() => { void setTraderView(false); })}
            >
              {switching ? 'Leaving…' : 'Back to admin'}
            </button>
          </div>
        )}

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
