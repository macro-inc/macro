import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { Mirror } from '../../src/core/mirror';

describe('Mirror dispose', () => {
  it('does not touch the doc when freeing one with an open transaction', async () => {
    const doc = new LoroDoc();
    const mirror = new Mirror({ doc });

    // Uncommitted. LoroDoc.free() commits from Drop after the JS pointer is zero
    // and flushes subscribers; calling back into the doc throws.
    doc.getText('text').insert(0, 'pending');
    mirror.dispose();

    let onRejection: (error: unknown) => void = () => {};
    const rejection = new Promise<unknown>((resolve) => {
      onRejection = resolve;
      process.on('unhandledRejection', onRejection);
    });

    doc.free();

    const outcome = await Promise.race([
      rejection.then((error) => ({ rejected: error })),
      new Promise<{ rejected: false }>((resolve) =>
        setTimeout(() => resolve({ rejected: false }), 20)
      ),
    ]);
    process.off('unhandledRejection', onRejection);

    expect(outcome.rejected).toBe(false);
  });
});
