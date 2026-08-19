import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppState, StoreDriver } from './types';

/**
 * A JSON file beside the app. Used in development and on any host with a real
 * disk, where it is the whole story.
 */
class FileDriver implements StoreDriver {
  readonly name = 'file';

  private writes = 0;

  constructor(private readonly file: string) {}

  async load(): Promise<AppState | null> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as AppState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(state: AppState): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // Write beside the target and rename, so a crash mid-write cannot leave a
    // half-written document behind. The counter keeps two saves that overlap
    // from claiming the same temporary name and renaming each other away.
    const temporary = `${this.file}.${process.pid}.${(this.writes += 1)}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(temporary, this.file);
  }
}

/**
 * Netlify's own key-value store. Netlify functions have no writable disk that
 * survives a request, so this is where the state lives in production.
 */
class BlobsDriver implements StoreDriver {
  readonly name = 'netlify-blobs';
  private store: { get(k: string, o?: { type: 'json' }): Promise<unknown>; setJSON(k: string, v: unknown): Promise<unknown> } | null = null;
  private readonly key = 'state.json';

  private async connect() {
    if (this.store) return this.store;
    const { getStore } = await import('@netlify/blobs');
    this.store = getStore({ name: 'forest-quote-desk', consistency: 'strong' });
    return this.store;
  }

  async load(): Promise<AppState | null> {
    const store = await this.connect();
    const value = await store.get(this.key, { type: 'json' });
    return (value as AppState | null) ?? null;
  }

  async save(state: AppState): Promise<void> {
    const store = await this.connect();
    await store.setJSON(this.key, state);
  }
}

/**
 * Netlify sets NETLIFY at build and run time. Anywhere else — a laptop, a
 * container, a VPS — the file driver is both available and preferable.
 */
export function createDriver(): StoreDriver {
  if (process.env.NETLIFY) return new BlobsDriver();
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'state.json');
  return new FileDriver(file);
}
