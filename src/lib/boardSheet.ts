/**
 * The price board as a file the team can be sent.
 *
 * The same grid the screen shows, drawn wide enough for every destination to
 * keep its own column. It carries the market it was priced at across the top,
 * because a board without its C and its date is a number with no provenance.
 */

export interface BoardSheetColumn {
  label: string;
  unit: string;
}

export interface BoardSheetRow {
  label: string;
  floorLabel: string;
  /** One per column: the price, and the bracket's floor when it differs. */
  cells: Array<{ price: string; floor: string | null }>;
}

export interface BoardSheetData {
  reference: string;
  /** What the margin field was doing, said plainly. */
  marginLabel: string;
  /** The market and terms the whole grid was priced on. */
  context: Array<[string, string]>;
  columns: BoardSheetColumn[];
  rows: BoardSheetRow[];
  footnote: string;
}

const SHEET_W = 1160;
const SHEET_SCALE = 2;
const M = 44;

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
  family?: 'Archivo' | 'DM Mono' | 'Montserrat';
  color?: string;
  align?: CanvasTextAlign;
  track?: number;
  caps?: boolean;
}

export function drawBoardSheet(canvas: HTMLCanvasElement, data: BoardSheetData): void {
  const HEAD = 108;
  const CONTEXT_TOP = HEAD + 34;
  const CONTEXT_H = 46;
  const GRID_TOP = CONTEXT_TOP + CONTEXT_H + 30;
  const COL_HEAD = 44;
  const ROW_H = 52;

  const height = GRID_TOP + COL_HEAD + data.rows.length * ROW_H + 76;

  canvas.width = SHEET_W * SHEET_SCALE;
  canvas.height = height * SHEET_SCALE;
  canvas.style.width = '100%';
  canvas.style.aspectRatio = `${SHEET_W} / ${height}`;

  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D is unavailable in this browser.');
  g.scale(SHEET_SCALE, SHEET_SCALE);
  g.textBaseline = 'alphabetic';

  const text = (body: string, x: number, y: number, o: TextOptions = {}) => {
    const {
      size = 12, weight = 400, family = 'Montserrat', color = FC.ink,
      align = 'left', track = 0, caps = false,
    } = o;
    g.save();
    g.fillStyle = color;
    g.font = `${weight} ${size}px "${family}", sans-serif`;
    g.textAlign = track ? 'left' : align;
    const shown = caps ? body.toUpperCase() : body;
    if (!track) {
      g.fillText(shown, x, y);
      g.restore();
      return;
    }
    const width = [...shown].reduce((sum, ch) => sum + g.measureText(ch).width + track, -track);
    let cursor = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    for (const ch of shown) {
      g.fillText(ch, cursor, y);
      cursor += g.measureText(ch).width + track;
    }
    g.restore();
  };

  g.fillStyle = FC.paper;
  g.fillRect(0, 0, SHEET_W, height);

  // ── header
  g.fillStyle = FC.navy;
  g.fillRect(0, 0, SHEET_W, HEAD);
  g.fillStyle = FC.yellow;
  g.beginPath();
  g.roundRect(M, 32, 42, 42, 9);
  g.fill();
  text('F', M + 21, 62, { size: 21, weight: 800, family: 'Archivo', color: FC.navyDark, align: 'center' });
  text('Forest Coffee', M + 58, 48, { size: 11, weight: 700, family: 'Archivo', color: '#fff', track: 3.2, caps: true });
  text('Price board', M + 58, 68, { size: 11, weight: 600, color: 'rgba(255,255,255,.62)', track: 2.4, caps: true });
  text(data.reference, SHEET_W - M, 48, { size: 12, weight: 500, family: 'DM Mono', color: FC.yellow, align: 'right' });
  text(
    new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    SHEET_W - M, 68, { size: 11, color: 'rgba(255,255,255,.62)', align: 'right' },
  );

  // ── the margin the grid is quoted at
  g.fillStyle = FC.yellow;
  g.fillRect(0, HEAD, SHEET_W, 34);
  text(data.marginLabel, M, HEAD + 22, {
    size: 11, weight: 700, family: 'Archivo', color: FC.navy, track: 2.4, caps: true,
  });

  // ── the market it was priced on
  let y = CONTEXT_TOP + 16;
  const perContext = (SHEET_W - M * 2) / data.context.length;
  data.context.forEach(([label, value], i) => {
    const x = M + i * perContext;
    text(label, x, y, { size: 8.5, weight: 700, family: 'Archivo', color: FC.ink300, track: 2.4, caps: true });
    text(value, x, y + 18, { size: 12, weight: 600, family: 'DM Mono', color: FC.navy });
  });

  // ── grid
  y = GRID_TOP;
  const labelW = 168;
  const colW = (SHEET_W - M * 2 - labelW) / data.columns.length;

  g.fillStyle = FC.cream;
  g.fillRect(M, y, SHEET_W - M * 2, COL_HEAD);
  text('Quantity', M + 12, y + 20, {
    size: 8.5, weight: 700, family: 'Archivo', color: FC.ink500, track: 2.4, caps: true,
  });
  data.columns.forEach((col, i) => {
    const right = M + labelW + colW * (i + 1) - 12;
    text(col.label, right, y + 18, {
      size: 8.5, weight: 700, family: 'Archivo', color: FC.ink500, track: 1.6, caps: true, align: 'right',
    });
    text(col.unit, right, y + 32, { size: 9, family: 'DM Mono', color: FC.ink300, align: 'right' });
  });
  y += COL_HEAD;

  data.rows.forEach((row) => {
    g.strokeStyle = FC.ink100;
    g.beginPath();
    g.moveTo(M, y);
    g.lineTo(SHEET_W - M, y);
    g.stroke();

    text(row.label, M + 12, y + 24, { size: 13, weight: 700, family: 'Archivo', color: FC.navy });
    text(row.floorLabel, M + 12, y + 40, { size: 10, family: 'DM Mono', color: FC.ink300 });

    row.cells.forEach((cell, i) => {
      const right = M + labelW + colW * (i + 1) - 12;
      text(cell.price, right, y + 26, { size: 14, weight: 700, family: 'DM Mono', color: FC.navy, align: 'right' });
      if (cell.floor) {
        text(cell.floor, right, y + 41, { size: 9.5, family: 'DM Mono', color: FC.ink300, align: 'right' });
      }
    });
    y += ROW_H;
  });

  g.strokeStyle = FC.navy;
  g.beginPath();
  g.moveTo(M, y);
  g.lineTo(SHEET_W - M, y);
  g.stroke();

  text(data.footnote, M, y + 26, { size: 10.5, color: FC.ink500 });
  text('forestcol.com · internal', M, height - 22, {
    size: 10, weight: 600, family: 'Archivo', color: FC.ink300, track: 2, caps: true,
  });
}

export function boardReference(seed: number): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `FC-BOARD-${day}-${String(seed % 100).padStart(2, '0')}`;
}

export function boardFileName(reference: string): string {
  return `${reference.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
}
