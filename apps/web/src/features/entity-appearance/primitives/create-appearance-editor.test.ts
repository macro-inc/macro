import { err, ok, type Result } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { EntityAppearance } from '../core/appearance';
import { createAppearanceEditor } from './create-appearance-editor';

const BLUE: EntityAppearance = {
  icon: { kind: 'macro', name: 'star' },
  color: 'blue',
};
const RED: EntityAppearance = { ...BLUE, color: 'red' };

describe('live appearance editing', () => {
  it('submits every pick immediately and leaves the newest choice visible', async () => {
    let resolveBlue!: (value: Result<void, string>) => void;
    let resolveRed!: (value: Result<void, string>) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Result<void, string>>((resolve) => {
            resolveBlue = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Result<void, string>>((resolve) => {
            resolveRed = resolve;
          })
      );
    const { editor, dispose } = createRoot((dispose) => ({
      dispose,
      editor: createAppearanceEditor({ isCurrent: () => true, save }),
    }));
    const first = editor.change(BLUE);
    const last = editor.change(RED);
    expect(save).toHaveBeenCalledTimes(2);
    expect(editor.appearance()).toEqual(RED);
    resolveBlue(ok(undefined));
    await first;
    expect(editor.appearance()).toEqual(RED);
    resolveRed(ok(undefined));
    await last;
    expect(editor.saving()).toBe(false);
    expect(editor.appearance()).toEqual(RED);
    dispose();
  });

  it('rolls back a rejected last pick to the last successful choice', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(err('unreachable'));
    const { editor, dispose } = createRoot((dispose) => ({
      dispose,
      editor: createAppearanceEditor({ isCurrent: () => true, save }),
    }));
    await editor.change(BLUE);
    await editor.change(RED);
    expect(editor.appearance()).toEqual(BLUE);
    expect(editor.error()).toBe('unreachable');
    dispose();
  });

  it('never lets a late older failure replace a newer successful pick', async () => {
    let rejectBlue!: (value: Result<void, string>) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Result<void, string>>((resolve) => {
            rejectBlue = resolve;
          })
      )
      .mockResolvedValueOnce(ok(undefined));
    const { editor, dispose } = createRoot((dispose) => ({
      dispose,
      editor: createAppearanceEditor({ isCurrent: () => true, save }),
    }));
    const first = editor.change(BLUE);
    await editor.change(RED);
    rejectBlue(err('unreachable'));
    await first;
    expect(editor.appearance()).toEqual(RED);
    expect(editor.error()).toBeUndefined();
    dispose();
  });

  it('retains an older pending pick when the latest pick fails', async () => {
    let resolveBlue!: (value: Result<void, string>) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Result<void, string>>((resolve) => {
            resolveBlue = resolve;
          })
      )
      .mockResolvedValueOnce(err('unreachable'));
    const { editor, dispose } = createRoot((dispose) => ({
      dispose,
      editor: createAppearanceEditor({ isCurrent: () => true, save }),
    }));
    const first = editor.change(BLUE);
    await editor.change(RED);
    expect(editor.appearance()).toEqual(BLUE);
    resolveBlue(ok(undefined));
    await first;
    expect(editor.appearance()).toEqual(BLUE);
    expect(editor.saving()).toBe(false);
    dispose();
  });

  it('does not submit duplicate choices or picks after the account changes', async () => {
    let current = true;
    const save = vi.fn().mockResolvedValue(ok(undefined));
    const { editor, dispose } = createRoot((dispose) => ({
      dispose,
      editor: createAppearanceEditor({ isCurrent: () => current, save }),
    }));
    await editor.change(BLUE);
    await editor.change(BLUE);
    current = false;
    await editor.change(RED);
    expect(save).toHaveBeenCalledOnce();
    dispose();
  });

  it('finishes the save but does not update a closed picker', async () => {
    let finish!: (value: Result<void, string>) => void;
    const { editor, dispose } = createRoot((dispose) => ({
      dispose,
      editor: createAppearanceEditor({
        isCurrent: () => true,
        save: () =>
          new Promise<Result<void, string>>((resolve) => {
            finish = resolve;
          }),
      }),
    }));
    const pending = editor.change(BLUE);
    dispose();
    finish(err('unreachable'));
    await pending;
    expect(editor.error()).toBeUndefined();
  });
});
