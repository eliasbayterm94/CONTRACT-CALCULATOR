/**
 * The one-page document a trader sends a client.
 *
 * Drawn straight onto a canvas rather than screenshotting the DOM, so the
 * preview and the exported file are the same pixels and nothing depends on how
 * the page happens to be laid out. Costs and margin never appear here.
 */

export interface QuoteSheetRows {
  title: string;
  head: string[];
  body: string[][];
}

export interface QuoteSheetData {
  title: string;
  client: string;
  reference: string;
  terms: Array<[string, string]>;
  priceLabel: string;
  price: string;
  priceSub: string;
  valueLabel: string;
  value: string;
  basis: string;
  rows: QuoteSheetRows | null;
}

const SHEET_W = 900;
const SHEET_SCALE = 2;

const FC = {
  navy: '#1b203d',
  navyDark: '#0f1226',
  yellow: '#e7e244',
  cream: '#f5f4ee',
  ink: '#0c0c0b',
  ink500: '#5a5a55',
  ink300: '#9a9a93',
  ink100: '#e8e8e2',
  paper: '#ffffff',
} as const;

interface TextOptions {
  size?: number;
  weight?: number;
  family?: 'Archivo' | 'Montserrat' | 'DM Mono';
  color?: string;
  align?: 'left' | 'right' | 'center';
  /** Extra letter-spacing. Canvas has none, so tracked runs draw glyph by glyph. */
  track?: number;
  caps?: boolean;
}

export function drawQuoteSheet(canvas: HTMLCanvasElement, data: QuoteSheetData): void {
  // Height is derived from the very steps the drawing walks through, so the
  // sheet can never come out too short and overrun its own footer.
  const TERMS_TOP = 252;
  const TERM_ROW = 52;
  const TABLE_HEAD = 30;
  const TABLE_ROW = 34;
  const PRICE_BLOCK = 132;

  let flow = TERMS_TOP + Math.ceil(data.terms.length / 2) * TERM_ROW + 6;
  if (data.rows) {
    flow += (data.rows.title ? 26 : 0) + TABLE_HEAD + data.rows.body.length * TABLE_ROW + 20;
  }
  flow += PRICE_BLOCK + 34;
  flow += 20;
  const height = flow + 70;

  canvas.width = SHEET_W * SHEET_SCALE;
  canvas.height = height * SHEET_SCALE;
  canvas.style.width = '100%';
  canvas.style.aspectRatio = `${SHEET_W} / ${height}`;

  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D is unavailable in this browser.');
  g.setTransform(SHEET_SCALE, 0, 0, SHEET_SCALE, 0, 0);
  const M = 48;

  const text = (str: string, x: number, y: number, o: TextOptions = {}) => {
    const {
      size = 13,
      weight = 400,
      family = 'Montserrat',
      color = FC.ink,
      align = 'left',
      track = 0,
      caps = false,
    } = o;
    g.save();
    g.fillStyle = color;
    g.textAlign = track ? 'left' : align;
    g.textBaseline = 'alphabetic';
    g.font = `${weight} ${size}px "${family}", sans-serif`;
    const body = caps ? String(str).toUpperCase() : String(str);
    if (!track) {
      g.fillText(body, x, y);
      g.restore();
      return;
    }
    const width = [...body].reduce((sum, ch) => sum + g.measureText(ch).width + track, -track);
    let cursor = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    for (const ch of body) {
      g.fillText(ch, cursor, y);
      cursor += g.measureText(ch).width + track;
    }
    g.restore();
  };

  g.fillStyle = FC.paper;
  g.fillRect(0, 0, SHEET_W, height);

  // ── header band
  g.fillStyle = FC.navy;
  g.fillRect(0, 0, SHEET_W, 108);
  g.fillStyle = FC.yellow;
  g.beginPath();
  g.roundRect(M, 32, 42, 42, 9);
  g.fill();
  text('F', M + 21, 62, { size: 21, weight: 800, family: 'Archivo', color: FC.navyDark, align: 'center' });
  text('Forest Coffee', M + 58, 48, { size: 11, weight: 700, family: 'Archivo', color: '#fff', track: 3.2, caps: true });
  text(data.title, M + 58, 68, { size: 11, weight: 600, color: 'rgba(255,255,255,.62)', track: 2.4, caps: true });
  text(data.reference, SHEET_W - M, 48, { size: 12, weight: 500, family: 'DM Mono', color: FC.yellow, align: 'right' });
  text(
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    SHEET_W - M, 68, { size: 11, color: 'rgba(255,255,255,.62)', align: 'right' },
  );

  // ── client
  let y = 156;
  text('Prepared for', M, y, { size: 9, weight: 700, family: 'Archivo', color: FC.ink500, track: 3, caps: true });
  text(data.client, M, y + 30, { size: 26, weight: 700, family: 'Archivo', color: FC.navy });

  // ── terms, two columns
  y += 66;
  g.strokeStyle = FC.ink100;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(M, y);
  g.lineTo(SHEET_W - M, y);
  g.stroke();
  y += 30;
  const colW = (SHEET_W - M * 2) / 2;
  data.terms.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW;
    const row = y + Math.floor(i / 2) * TERM_ROW;
    text(label, x, row, { size: 9, weight: 700, family: 'Archivo', color: FC.ink300, track: 2.6, caps: true });
    text(value, x, row + 20, { size: 14, weight: 500, color: FC.ink });
  });
  y += Math.ceil(data.terms.length / 2) * TERM_ROW + 6;

  // ── shipment plan
  if (data.rows) {
    if (data.rows.title) {
      text(data.rows.title, M, y + 12, { size: 9, weight: 700, family: 'Archivo', color: FC.ink500, track: 3, caps: true });
      y += 26;
    }
    g.fillStyle = FC.cream;
    g.fillRect(M, y, SHEET_W - M * 2, TABLE_HEAD);
    const cols = [M + 14, M + 300, M + 470, SHEET_W - M - 14];
    data.rows.head.forEach((h, i) =>
      text(h, cols[i], y + 20, {
        size: 9, weight: 700, family: 'Archivo', color: FC.ink500,
        track: 2.2, caps: true, align: i >= 1 ? 'right' : 'left',
      }),
    );
    y += TABLE_HEAD;
    data.rows.body.forEach((row) => {
      row.forEach((cell, i) =>
        text(cell, cols[i], y + 22, {
          size: 13, weight: 500,
          family: i === 0 ? 'Montserrat' : 'DM Mono',
          color: FC.ink, align: i >= 1 ? 'right' : 'left',
        }),
      );
      y += TABLE_ROW;
      g.strokeStyle = FC.ink100;
      g.beginPath();
      g.moveTo(M, y);
      g.lineTo(SHEET_W - M, y);
      g.stroke();
    });
    y += 20;
  }

  // ── price block
  g.fillStyle = FC.navy;
  g.beginPath();
  g.roundRect(M, y, SHEET_W - M * 2, PRICE_BLOCK, 12);
  g.fill();
  text(data.priceLabel, M + 28, y + 36, {
    size: 9, weight: 700, family: 'Archivo', color: 'rgba(255,255,255,.62)', track: 3, caps: true,
  });

  // Whole units full size, cents deliberately smaller.
  const dot = data.price.lastIndexOf('.');
  const whole = dot < 0 ? data.price : data.price.slice(0, dot);
  const frac = dot < 0 ? '' : data.price.slice(dot);
  g.save();
  g.fillStyle = FC.yellow;
  g.font = '800 46px "Archivo", sans-serif';
  g.fillText(whole, M + 28, y + 88);
  const wholeW = g.measureText(whole).width;
  g.font = '800 28px "Archivo", sans-serif';
  g.fillText(frac, M + 28 + wholeW, y + 88);
  g.restore();
  text(data.priceSub, M + 28, y + 112, { size: 11, family: 'DM Mono', color: 'rgba(255,255,255,.62)' });

  text(data.valueLabel, SHEET_W - M - 28, y + 36, {
    size: 9, weight: 700, family: 'Archivo', color: 'rgba(255,255,255,.62)', track: 3, caps: true, align: 'right',
  });
  text(data.value, SHEET_W - M - 28, y + 82, {
    size: 30, weight: 700, family: 'Archivo', color: '#fff', align: 'right',
  });
  y += PRICE_BLOCK + 34;

  text(data.basis, M, y, { size: 12, color: FC.ink500 });
  text('Subject to final contract. Prices valid for 3 business days from the date above.', M, y + 20, {
    size: 11, color: FC.ink300,
  });

  g.strokeStyle = FC.ink100;
  g.beginPath();
  g.moveTo(M, height - 44);
  g.lineTo(SHEET_W - M, height - 44);
  g.stroke();
  text('forestcol.com', M, height - 22, {
    size: 10, weight: 600, family: 'Archivo', color: FC.ink300, track: 2, caps: true,
  });
}

/** A stable-ish reference for a sheet drawn before the quote is saved. */
export function draftReference(seed: number): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `FC-${day}-${String(seed % 1000).padStart(3, '0')}`;
}

export function fileNameFor(reference: string, client: string): string {
  const slug = (client || 'quote').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
  return `${reference}-${slug || 'quote'}.png`;
}
