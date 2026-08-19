import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppState, StoreDriver } from './types';

const STORE_NAME = 'forest-quote-desk';

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
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      // Write beside the target and rename, so a crash mid-write cannot leave
      // a half-written document behind. The counter keeps two saves that
      // overlap from claiming the same temporary name and renaming each other
      // away.
      const temporary = `${this.file}.${process.pid}.${(this.writes += 1)}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
      await fs.rename(temporary, this.file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `Cannot write ${this.file}: the filesystem is read-only. On a serverless host ` +
            'the state belongs in a managed store — on Netlify that is Netlify Blobs, which ' +
            'this app uses automatically when its environment is present. See src/lib/store/drivers.ts.',
          { cause: error },
        );
      }
      throw error;
    }
  }
}

interface BlobStore {
  get(key: string, options?: { type: 'json' }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}

/**
 * Netlify's own key-value store. Netlify functions have no writable disk that
 * survives a request, so this is where the state lives in production.
 */
class BlobsDriver implements StoreDriver {
  readonly name = 'netlify-blobs';
  private readonly key = 'state.json';

  constructor(private readonly store: BlobStore) {}

  async load(): Promise<AppState | null> {
    return ((await this.store.get(this.key, { type: 'json' })) as AppState | null) ?? null;
  }

  async save(state: AppState): Promise<void> {
    await this.store.setJSON(this.key, state);
  }
}

/**
 * Ask Netlify Blobs for a store, or find out it is not on offer.
 *
 * getStore() throws MissingBlobsEnvironmentError the moment its context is
 * absent, which makes the store itself the test. Probing it beats reading an
 * environment variable: NETLIFY is documented for the build, and a build-time
 * flag says nothing about what the function has at runtime — reading it was
 * what sent the deployed site to the read-only application directory.
 */
async function tryBlobs(): Promise<StoreDriver | null> {
  try {
    const { getStore } = await import('@netlify/blobs');
    return new BlobsDriver(getStore({ name: STORE_NAME, consistency: 'strong' }) as BlobStore);
  } catch {
    return null;
  }
}

/**
 * DATABASE_PATH wins, so a container with a mounted volume can say where the
 * document goes. Otherwise Blobs if this host offers it, and a local file if
 * it does not.
 */
export async function createDriver(): Promise<StoreDriver> {
  if (process.env.DATABASE_PATH) return new FileDriver(process.env.DATABASE_PATH);
  return (await tryBlobs()) ?? new FileDriver(path.join(process.cwd(), 'data', 'state.json'));
}
