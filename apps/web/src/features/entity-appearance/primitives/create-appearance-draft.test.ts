import { err, ok, type Result } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createAppearanceDraft } from './create-appearance-draft';

describe('appearance Apply lifecycle', () => {
  it('keeps failed drafts and saves both overrides on retry', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(err('unreachable'))
      .mockResolvedValueOnce(ok(undefined));
    const onSaved = vi.fn();
    const { draft, dispose } = createRoot((dispose) => ({
      dispose,
      draft: createAppearanceDraft({ isCurrent: () => true, save, onSaved }),
    }));
    const appearance = {
      icon: { kind: 'macro' as const, name: 'star' },
      color: 'blue' as const,
    };
    draft.change(appearance);
    await draft.apply();
    expect(draft.appearance()).toEqual(appearance);
    expect(draft.error()).toBe('unreachable');
    expect(draft.saving()).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    await draft.apply();
    expect(save).toHaveBeenLastCalledWith(appearance);
    expect(onSaved).toHaveBeenCalledOnce();
    dispose();
  });

  it('prevents duplicate writes and ignores completion after account changes', async () => {
    let resolve!: (value: Result<void, string>) => void;
    const request = new Promise<Result<void, string>>((done) => {
      resolve = done;
    });
    const save = vi.fn(() => request);
    const onSaved = vi.fn();
    let current = true;
    const { draft, dispose } = createRoot((dispose) => ({
      dispose,
      draft: createAppearanceDraft({ isCurrent: () => current, save, onSaved }),
    }));
    draft.change({ color: 'blue', icon: null });
    const first = draft.apply();
    await draft.apply();
    expect(save).toHaveBeenCalledOnce();
    current = false;
    resolve(ok(undefined));
    await first;
    expect(onSaved).not.toHaveBeenCalled();
    dispose();
  });

  it('does not close a retired editor after a successful write', async () => {
    let resolve!: (value: Result<void, string>) => void;
    const request = new Promise<Result<void, string>>((done) => {
      resolve = done;
    });
    const onSaved = vi.fn();
    const { draft, dispose } = createRoot((dispose) => ({
      dispose,
      draft: createAppearanceDraft({
        isCurrent: () => true,
        save: () => request,
        onSaved,
      }),
    }));
    draft.change({ color: 'purple', icon: { kind: 'emoji', value: '😀' } });
    const pending = draft.apply();
    dispose();
    resolve(ok(undefined));
    await pending;
    expect(onSaved).not.toHaveBeenCalled();
  });
});
