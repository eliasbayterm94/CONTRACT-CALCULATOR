import { describe, expect, it } from 'vitest';
import { monthOfYear, premiumForMonth } from './premium';
import type { PremiumOverride, SeasonalPremium } from '../store/types';

const season = (month: number, cents: number, by = 'admin'): SeasonalPremium => ({
  month,
  premiumCents: cents,
  updatedAt: '2026-01-01T00:00:00Z',
  updatedBy: by,
});

const override = (monthKey: string, cents: number, note = ''): PremiumOverride => ({
  monthKey,
  premiumCents: cents,
  note,
  updatedAt: '2026-01-01T00:00:00Z',
  updatedBy: 'admin',
});

const SEASON = [season(8, 40), season(10, 45), season(12, 48)];

describe('the premium a shipment month resolves to', () => {
  it('takes the seasonal figure for its month of the year', () => {
    const r = premiumForMonth('2026-08', SEASON, []);
    expect(r.premiumCents).toBe(40);
    expect(r.source).toBe('seasonal');
  });

  it('applies the same season to every year', () => {
    expect(premiumForMonth('2029-08', SEASON, []).premiumCents).toBe(40);
    expect(premiumForMonth('2026-08', SEASON, []).premiumCents).toBe(40);
  });

  it('lets a dated exception beat its season', () => {
    const r = premiumForMonth('2026-10', SEASON, [override('2026-10', 62, 'Short crop')]);
    expect(r.premiumCents).toBe(62);
    expect(r.source).toBe('override');
    expect(r.note).toBe('Short crop');
  });

  it('keeps an exception to its own year', () => {
    const overrides = [override('2026-10', 62)];
    expect(premiumForMonth('2027-10', SEASON, overrides).premiumCents).toBe(45);
    expect(premiumForMonth('2027-10', SEASON, overrides).source).toBe('seasonal');
  });

  it('reports a month with no figure as unset rather than borrowing one', () => {
    // September sits between two months that do have figures. Neither is it.
    const r = premiumForMonth('2026-09', SEASON, []);
    expect(r.source).toBe('unset');
    expect(r.premiumCents).toBe(0);
  });

  it('treats a seeded row as never set', () => {
    const r = premiumForMonth('2026-08', [season(8, 0, 'seed')], []);
    expect(r.source).toBe('unset');
  });

  it('honours a deliberate zero', () => {
    const r = premiumForMonth('2026-08', [season(8, 0, 'admin')], []);
    expect(r.source).toBe('seasonal');
    expect(r.premiumCents).toBe(0);
  });

  it('honours an exception set to zero', () => {
    const r = premiumForMonth('2026-08', SEASON, [override('2026-08', 0)]);
    expect(r.source).toBe('override');
    expect(r.premiumCents).toBe(0);
  });

  it('does not fall over on a key that is not a month', () => {
    // The old model keyed premiums by KC contract month, like "2026U".
    expect(premiumForMonth('2026U', SEASON, []).source).toBe('unset');
    expect(monthOfYear('2026U')).toBeNull();
  });

  it('reads every month of the year', () => {
    expect(monthOfYear('2026-01')).toBe(1);
    expect(monthOfYear('2026-12')).toBe(12);
    expect(monthOfYear('2026-13')).toBeNull();
    expect(monthOfYear('2026-00')).toBeNull();
  });
});
