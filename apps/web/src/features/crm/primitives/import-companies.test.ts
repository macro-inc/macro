import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createCompanyImport } from './import-companies';

const file = (text: string) => ({ size: text.length, text: async () => text });

describe('company import', () => {
  it('retries only failed rows and preserves the successful count', async () => {
    let fail = true;
    const create = vi.fn(async (row: { name: string; domain: string }) => {
      if (row.name === 'Retry' && fail) throw new Error('temporary failure');
    });
    const { state, dispose } = createRoot((dispose) => ({
      state: createCompanyImport(create),
      dispose,
    }));
    await state.read(
      file('Name,Domain\nDone,DONE.EXAMPLE\nRetry,retry.example')
    );
    expect(state.error()).toBe('');
    await state.run();
    expect(state.completed()).toBe(1);
    expect(state.rows()).toEqual([{ name: 'Retry', domain: 'retry.example' }]);
    expect(state.error()).toContain('Successful rows will not be retried');
    fail = false;
    await state.run();
    expect(state.completed()).toBe(2);
    expect(state.rows()).toEqual([]);
    expect(create.mock.calls.map(([row]) => row.name)).toEqual([
      'Done',
      'Retry',
      'Retry',
    ]);
    dispose();
  });
  it('rejects oversized and invalid files before any mutation', async () => {
    const create = vi.fn();
    const { state, dispose } = createRoot((dispose) => ({
      state: createCompanyImport(create),
      dispose,
    }));
    await state.read(file('x'.repeat(1024 * 1024 + 1)));
    expect(state.error()).toContain('smaller than 1 MB');
    await state.read(file('name,domain\nInvalid,https://example.com'));
    await state.run();
    expect(create).not.toHaveBeenCalled();
    expect(state.rows()).toEqual([]);
    dispose();
  });
});
