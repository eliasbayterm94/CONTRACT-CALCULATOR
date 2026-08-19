import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDriver } from './drivers';

const KEYS = ['DATABASE_PATH', 'NETLIFY', 'NETLIFY_BLOBS_CONTEXT'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const blobsContext = () =>
  Buffer.from(
    JSON.stringify({ siteID: 'test-site', token: 'test-token', edgeURL: 'http://localhost:9999' }),
  ).toString('base64');

describe('createDriver', () => {
  it('uses Netlify Blobs when the host provides its environment', async () => {
    delete process.env.DATABASE_PATH;
    process.env.NETLIFY_BLOBS_CONTEXT = blobsContext();
    expect((await createDriver()).name).toBe('netlify-blobs');
  });

  it('falls back to a file when Blobs is not on offer', async () => {
    delete process.env.DATABASE_PATH;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    expect((await createDriver()).name).toBe('file');
  });

  it('ignores NETLIFY on its own, because a build flag is not a runtime store', async () => {
    delete process.env.DATABASE_PATH;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    process.env.NETLIFY = 'true';
    expect((await createDriver()).name).toBe('file');
  });

  it('lets DATABASE_PATH override a host that offers Blobs', async () => {
    process.env.DATABASE_PATH = '/tmp/state.json';
    process.env.NETLIFY_BLOBS_CONTEXT = blobsContext();
    expect((await createDriver()).name).toBe('file');
  });
});

describe('FileDriver on a read-only host', () => {
  it('explains that the state belongs in a managed store', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', () => ({
      default: {
        mkdir: async () => {
          throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
        },
        readFile: async () => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        writeFile: async () => undefined,
        rename: async () => undefined,
      },
    }));
    process.env.DATABASE_PATH = '/var/task/data/state.json';
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    const { createDriver: fresh } = await import('./drivers');
    const driver = await fresh();
    await expect(driver.save({} as never)).rejects.toThrow(/read-only[\s\S]*Netlify Blobs/);
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });
});
