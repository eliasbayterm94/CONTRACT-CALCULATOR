'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import KcField from './KcField';
import SheetDialog from './SheetDialog';
import {
  boardFileName,
  boardReference,
  drawBoardSheet,
  type BoardSheetData,
} from '@/lib/boardSheet';
import { calculateQuote, rungAt, volumeBand } from '@/lib/pricing/engine';
import { MONTH_OF_YEAR_NAMES, monthOfYear, premiumForMonth } from '@/lib/pricing/premium';
import { PRICE_DP, UNIT_LABEL } from '@/lib/pricing/units';
import { monthIndex, monthKeyFrom, monthLabel, type CalendarMonth } from '@/lib/pricing/schedule';
import type { Incoterm, ReferenceData, VolumeBracket } from '@/lib/pricing/types';
import type { PremiumOverride, SeasonalPremium } from '@/lib/store/types';
import { cents, money, plain } from '@/lib/format';

/** Refreshed while the board is open and the tab is in front. */
const REFRESH_MS = 5 * 60 * 1000;

interface Props {
  reference: ReferenceData;
  months: CalendarMonth[];
  season: SeasonalPremium[];
  overrides: PremiumOverride[];
  defaultKcCents: number;
  kcSpot: { priceCents: number; asOf: string; source: string } | null;
}

/**
 * Every price the desk quotes, on one screen.
 *
 * A board rather than a quote: no client, no window, no schedule — the volume
 * brackets down one side and the destinations across the other, at whatever
 * the C is doing right now. It answers the question a trader is asked on the
 * phone before there is a quote to build.
 */
export default function PriceBoard({
  reference,
  months,
  season,
  overrides,
  defaultKcCents,
  kcSpot,
}: Props) {
  const settings = reference.settings;
  const brackets = useMemo(
    () => [...(settings.volumeBrackets ?? [])].sort((a, b) => a.fromBags - b.fromBags),
    [settings.volumeBrackets],
  );

  const [kcCents, setKcCents] = useState(String(defaultKcCents || ''));
  const [processKey, setProcessKey] = useState(reference.processes[0]?.key ?? '');
  const [packagingKey, setPackagingKey] = useState(
    reference.packaging.find((p) => p.traderDefault)?.key ?? reference.packaging[0]?.key ?? '',
  );
  const [incoterm, setIncoterm] = useState<Incoterm>('DDP');
  const [holdMonths, setHoldMonths] = useState(2);
  const [waiveFixedCost, setWaiveFixedCost] = useState(false);
  /** Empty means each bracket sits on its own floor. */
  const [margin, setMargin] = useState('25');
  const [month, setMonth] = useState(months[0]?.key ?? '');
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [sheet, setSheet] = useState<BoardSheetData | null>(null);

  /**
   * Pull the C on open, and again while the board is left up.
   *
   * A board is something you leave on a second screen, so a price that was
   * right an hour ago is worse than no price. Only when the tab is in front:
   * a hidden tab polling a market feed is nobody's idea of useful.
   */
  const refreshKc = useCallback(async () => {
    try {
      const res = await fetch('/api/kc/latest', { cache: 'no-store' });
      const body = await res.json();
      const quote = body.ok ? body.quote : body.fallback;
      if (quote) {
        setKcCents(quote.priceCents.toFixed(2));
        setRefreshedAt(new Date().toISOString());
      }
    } catch {
      // The field keeps whatever it had, and says how old it is.
    }
  }, []);

  useEffect(() => {
    void refreshKc();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshKc();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshKc]);

  const premium = useMemo(
    () => premiumForMonth(month, season, overrides),
    [month, season, overrides],
  );
  const monthName = MONTH_OF_YEAR_NAMES[(monthOfYear(month) ?? 1) - 1];

  const destinations = reference.destinations;
  const typedMargin = margin.trim() === '' ? null : Number(margin) / 100;
  const marginValid = typedMargin === null || (Number.isFinite(typedMargin) && typedMargin < 1);

  /**
   * One price per bracket per destination.
   *
   * The quantity is the bracket's own first bag. Cost per pound does not move
   * with volume — a part load ships consolidated — so the bracket changes the
   * floor and nothing else, and any quantity inside it prices the same.
   */
  const board = useMemo(() => {
    if (!marginValid) return null;
    return brackets.map((bracket: VolumeBracket) => {
      const cells = destinations.map((destination) => {
        const input = {
          destinationKey: destination.key,
          incoterm,
          processKey,
          packagingKey,
          bags: bracket.fromBags,
          kcUsdPerLb: (Number(kcCents) || 0) / 100,
          premiumUsdPerLb: premium.premiumCents / 100,
          holdMonths,
          fromMonth: month,
          // A hold can never outrun the shipment window, so the board's window
          // is as long as the hold it is pricing. With a single month here the
          // carry was capped to one and the selector did nothing.
          toMonth: monthKeyFrom(monthIndex(month) + Math.max(0, holdMonths - 1)),
          waiveFixedCost,
        };
        try {
          // A destination the desk has not finished configuring should leave a
          // dash in its own column, not take the board down with it.
          const atFloor = calculateQuote(input, reference).floor;
          const atTyped = typedMargin === null ? null : rungAt(typedMargin, input, reference);
          return { key: destination.key, destination, atFloor, atTyped };
        } catch {
          return { key: destination.key, destination, atFloor: null, atTyped: null };
        }
      });
      return { bracket, band: volumeBand(bracket.fromBags, settings), cells };
    });
  }, [brackets, destinations, incoterm, processKey, packagingKey, kcCents, premium,
      holdMonths, month, waiveFixedCost, reference, typedMargin, marginValid, settings]);

  const marginLabel =
    typedMargin === null
      ? "Each bracket at its own floor"
      : `Quoted at ${plain(Number(margin), 2)}%`;

  const packagingLabel = reference.packaging.find((p) => p.key === packagingKey)?.label ?? '';
  const typeLabel = reference.processes.find((p) => p.key === processKey)?.label ?? '';

  /** The grid on screen, as the file the team gets. */
  const buildSheet = useCallback((): BoardSheetData | null => {
    if (!board) return null;
    return {
      reference: boardReference(Date.now()),
      marginLabel,
      context: [
        ['KC', `${plain(Number(kcCents) || 0, 2)}¢`],
        ['Premium', premium.source === 'unset' ? 'not set' : `${plain(premium.premiumCents, 2)}¢`],
        ['Shipping', monthLabel(month)],
        ['Held', `${holdMonths} month${holdMonths === 1 ? '' : 's'}`],
        ['Incoterm', incoterm],
        ['Coffee', typeLabel],
        ['Packaging', packagingLabel],
      ],
      columns: destinations.map((d) => ({
        label: d.label,
        unit: `${d.quoteCurrency}/${UNIT_LABEL[d.quoteUnit]}`,
      })),
      rows: board.map((row) => ({
        label: row.band.label,
        floorLabel: `floor ${plain(row.bracket.minMargin * 100, 0)}%`,
        cells: row.cells.map((cell) => {
          const shown = cell.atTyped ?? cell.atFloor;
          const differs =
            cell.atTyped && cell.atFloor &&
            Math.abs(cell.atTyped.displayPrice - cell.atFloor.displayPrice) > 1e-9;
          return {
            price: shown
              ? money(shown.displayPrice, cell.destination.quoteCurrency, PRICE_DP)
              : '—',
            floor:
              differs && cell.atFloor
                ? `floor ${money(cell.atFloor.displayPrice, cell.destination.quoteCurrency, PRICE_DP)}`
                : null,
          };
        }),
      })),
      footnote:
        `${waiveFixedCost ? 'Fixed cost waived. ' : ''}Cost per pound does not move with volume — ` +
        'a part load ships consolidated — so the bracket sets the floor and nothing else. ' +
        'Prices move with the C: confirm before quoting.',
    };
  }, [board, marginLabel, kcCents, premium, month, holdMonths, incoterm, typeLabel,
      packagingLabel, destinations, waiveFixedCost, margin]);

  const renderSheet = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (sheet) drawBoardSheet(canvas, sheet);
    },
    [sheet],
  );

  const kcAge = refreshedAt
    ? `Refreshed ${new Date(refreshedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : null;

  return (
    <>
      <div className="qc-market" data-field-scope>
        <div className="qc-market-grid">
          <div>
            <span className="qc-market-label">KC price ¢/lb</span>
            <KcField value={kcCents} onChange={setKcCents} spot={kcSpot} />
            {kcAge && <p className="qc-market-hint">{kcAge} · refreshes every 5 minutes</p>}
          </div>
          <div>
            <span className="qc-market-label">Margin</span>
            <div className="qc-inputrow">
              <input
                className="qc-input num" type="number" step="any" inputMode="decimal"
                aria-label="Board margin percent"
                placeholder="floors"
                value={margin} onChange={(e) => setMargin(e.target.value)}
              />
              <span className="qc-suffix">%</span>
            </div>
            <p className="qc-market-hint">
              {typedMargin === null ? (
                'Each bracket on its own floor.'
              ) : (
                <>
                  Every bracket at {plain(Number(margin), 2)}% ·{' '}
                  <button type="button" className="qc-linkish" onClick={() => setMargin('')}>
                    use the floors
                  </button>
                </>
              )}
            </p>
          </div>
          <div>
            <span className="qc-market-label">Shipping month</span>
            <select className="qc-select" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <p className={`qc-market-hint${premium.source === 'unset' ? ' is-bad' : ''}`}>
              {premium.source === 'unset'
                ? `No premium set for ${monthName}`
                : `Premium ${plain(premium.premiumCents, 2)}¢ · ${monthName}`}
            </p>
          </div>
          <div>
            <span className="qc-market-label">Held for</span>
            <select
              className="qc-select" value={holdMonths}
              onChange={(e) => setHoldMonths(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>
              ))}
            </select>
            <p className="qc-market-hint">
              {holdMonths <= settings.freeHoldMonths
                ? 'No storage or finance at this length.'
                : `${holdMonths - settings.freeHoldMonths} month${holdMonths - settings.freeHoldMonths === 1 ? '' : 's'} billed.`}
            </p>
          </div>
        </div>
      </div>

      <section className="qc-panel">
        <div className="qc-panel-head">
          <h2 className="qc-panel-title">
            Price board
            <span className={`qc-margintag${typedMargin === null ? ' is-floors' : ''}`}>
              {marginLabel}
            </span>
          </h2>
          <button
            type="button" className="fc-btn fc-btn-navy"
            disabled={!board}
            onClick={() => setSheet(buildSheet())}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
            </svg>
            Download board
          </button>
        </div>

        <div className="qc-board-bar">
          <div className="qc-board-controls">
            <select
              className="qc-select" value={processKey} aria-label="Coffee type"
              onChange={(e) => setProcessKey(e.target.value)}
            >
              {reference.processes.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.premiumCents ? `${p.label} · +${plain(p.premiumCents, 0)}¢` : p.label}
                </option>
              ))}
            </select>
            <select
              className="qc-select" value={packagingKey} aria-label="Packaging"
              onChange={(e) => setPackagingKey(e.target.value)}
            >
              {reference.packaging.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <div className="qc-seg" role="group" aria-label="Incoterm">
              {(['FOB', 'CIF', 'DDP'] as Incoterm[]).map((i) => (
                <button
                  key={i} type="button"
                  className={`qc-seg-btn${incoterm === i ? ' is-on' : ''}`}
                  onClick={() => setIncoterm(i)}
                >
                  {i}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`fc-btn fc-btn-ghost${waiveFixedCost ? ' is-on' : ''}`}
              aria-pressed={waiveFixedCost}
              onClick={() => setWaiveFixedCost((on) => !on)}
            >
              {waiveFixedCost ? 'Fixed cost waived' : 'Waive fixed cost'}
            </button>
          </div>
        </div>

        {!marginValid ? (
          <div className="qc-panel-body">
            <div className="qc-answer is-empty">A margin has to be under 100%.</div>
          </div>
        ) : (
          <div className="qc-table-wrap">
            <table className="qc-table qc-board">
              <thead>
                <tr>
                  <th>Quantity</th>
                  {destinations.map((d) => (
                    <th key={d.key} className="qc-num">
                      {d.label}
                      <span className="qc-board-unit">
                        {d.quoteCurrency}/{UNIT_LABEL[d.quoteUnit]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board?.map((row) => (
                  <tr key={row.bracket.fromBags}>
                    <td>
                      <strong>{row.band.label}</strong>
                      <span className="qc-board-floor">
                        floor {plain(row.bracket.minMargin * 100, 0)}%
                      </span>
                    </td>
                    {row.cells.map((cell) => {
                      const shown = cell.atTyped ?? cell.atFloor;
                      const differs =
                        cell.atTyped && cell.atFloor &&
                        Math.abs(cell.atTyped.displayPrice - cell.atFloor.displayPrice) > 1e-9;
                      return (
                        <td key={cell.key} className="qc-num qc-board-cell">
                          {shown ? (
                            <>
                              <strong>
                                {money(shown.displayPrice, cell.destination.quoteCurrency, PRICE_DP)}
                              </strong>
                              {differs && cell.atFloor && (
                                <span className="qc-board-alt">
                                  floor {money(cell.atFloor.displayPrice, cell.destination.quoteCurrency, PRICE_DP)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="qc-board-alt">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="qc-footnote">
          Priced at KC {plain(Number(kcCents) || 0, 2)}¢ for {monthLabel(month)}, held {holdMonths}{' '}
          month{holdMonths === 1 ? '' : 's'}, {incoterm}. Cost per pound does not move with volume —
          a part load ships consolidated — so the bracket sets the floor and nothing else.
        </p>
      </section>

      <SheetDialog
        data={sheet}
        render={renderSheet}
        filename={sheet ? boardFileName(sheet.reference) : 'price-board.png'}
        title="Price board"
        onClose={() => setSheet(null)}
      />
    </>
  );
}

