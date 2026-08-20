export interface ActionOutcome {
  ok: boolean;
  message: string;
}

/**
 * A failed save reports itself; it does not take the page down.
 *
 * A server action that throws surfaces as Next's own error screen — the whole
 * admin page replaced by "a server-side exception has occurred" and a digest,
 * with the edits still in the boxes and no way to tell what went wrong. In
 * production the store is over the network, so a write can fail for reasons
 * that have nothing to do with the form: a blip, a timeout, a conflict. Those
 * belong in the save bar.
 *
 * The message says what is and is not known. It does not claim nothing was
 * written, because a save that fails partway through has already written some.
 */
export function guarded<A extends unknown[], R extends ActionOutcome>(
  name: string,
  run: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | ActionOutcome> {
  return async (...args: A) => {
    try {
      return await run(...args);
    } catch (error) {
      // Goes to the host's function log, where the stack is readable.
      console.error(`[action:${name}]`, error);
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Save failed: ${reason}. Check the figures against Rates & costs before trusting them.`,
      };
    }
  };
}
