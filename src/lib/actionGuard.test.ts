import { afterEach, describe, expect, it, vi } from 'vitest';
import { guarded } from './actionGuard';

afterEach(() => vi.restoreAllMocks());

describe('a save that fails', () => {
  it('passes a success straight through', async () => {
    const run = guarded('saveThing', async () => ({ ok: true, message: 'Saved 8 rows.' }));
    expect(await run()).toEqual({ ok: true, message: 'Saved 8 rows.' });
  });

  it('turns a throw into something the save bar can show', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = guarded('saveThing', async () => {
      throw new Error('The blob store did not respond');
    });
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.message).toContain('The blob store did not respond');
  });

  it('never rethrows, whatever was thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const thrown of [new Error('boom'), 'a bare string', null, undefined, { code: 503 }]) {
      const run = guarded('saveThing', async () => {
        throw thrown;
      });
      await expect(run()).resolves.toMatchObject({ ok: false });
    }
  });

  it('logs the failure where the host can find it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('timeout');
    await guarded('saveDestinations', async () => {
      throw boom;
    })();
    expect(spy).toHaveBeenCalledWith('[action:saveDestinations]', boom);
  });

  it('does not claim the write never happened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await guarded('saveThing', async () => {
      throw new Error('half way');
    })();
    // A loop that dies partway has already written rows; saying "nothing was
    // changed" would be a lie the desk might act on.
    expect(out.message).not.toMatch(/nothing was (changed|saved|written)/i);
    expect(out.message).toMatch(/check the figures/i);
  });

  it('keeps the arguments it was given', async () => {
    const run = guarded('saveThing', async (a: number, b: string) => ({
      ok: true,
      message: `${a}-${b}`,
    }));
    expect(await run(7, 'x')).toEqual({ ok: true, message: '7-x' });
  });
});
