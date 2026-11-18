import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createUnsavedChangesGuard } from './create-unsaved-changes-guard';

function setup(initiallyDirty = true) {
  let dispose!: () => void;
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [dirty, setDirty] = createSignal(initiallyDirty);
    const save = vi.fn(async () => {
      setDirty(false);
    });
    const discard = vi.fn();
    const guard = createUnsavedChangesGuard({
      dirty,
      busy: () => false,
      save,
      discard,
      saveError: 'Save failed',
    });
    return { guard, save, discard, setDirty, dispose };
  });
}

describe('unsaved changes leave guard', () => {
  it('leaves clean state without prompting', () => {
    const state = setup(false);
    expect(state.guard.requestLeave()).toBe(true);
    expect(state.guard.open()).toBe(false);
    state.dispose();
  });

  it('keeps dirty state when the user cancels', async () => {
    const state = setup();
    const leaving = state.guard.requestLeave();
    expect(state.guard.open()).toBe(true);
    state.guard.keepEditing();
    expect(await leaving).toBe(false);
    expect(state.save).not.toHaveBeenCalled();
    expect(state.discard).not.toHaveBeenCalled();
    state.dispose();
  });

  it('allows discard and closes the prompt', async () => {
    const state = setup();
    const leaving = state.guard.requestLeave();
    state.guard.discard();
    expect(await leaving).toBe(true);
    expect(state.discard).toHaveBeenCalledOnce();
    expect(state.guard.open()).toBe(false);
    state.dispose();
  });

  it('saves before allowing the navigation', async () => {
    const state = setup();
    const leaving = state.guard.requestLeave();
    await state.guard.save();
    expect(await leaving).toBe(true);
    expect(state.save).toHaveBeenCalledOnce();
    expect(state.discard).not.toHaveBeenCalled();
    state.dispose();
  });

  it('keeps the prompt after a failed save and supports retry', async () => {
    const state = setup();
    state.save.mockRejectedValueOnce(new Error('Offline'));
    const leaving = state.guard.requestLeave();
    await state.guard.save();
    expect(state.guard.error()).toBe('Offline');
    expect(state.guard.open()).toBe(true);
    await state.guard.save();
    expect(await leaving).toBe(true);
    state.dispose();
  });

  it('refuses to leave if edits arrive during save', async () => {
    const state = setup();
    state.save.mockImplementationOnce(async () => {});
    const leaving = state.guard.requestLeave();
    await state.guard.save();
    expect(state.guard.open()).toBe(true);
    expect(state.guard.error()).toBe(
      'Your latest changes still need to be saved.'
    );
    state.guard.keepEditing();
    expect(await leaving).toBe(false);
    state.dispose();
  });

  it('cancels an aborted navigation without discarding', async () => {
    const state = setup();
    const controller = new AbortController();
    const leaving = state.guard.requestLeave(controller.signal);
    controller.abort();
    expect(await leaving).toBe(false);
    expect(state.guard.open()).toBe(false);
    expect(state.discard).not.toHaveBeenCalled();
    state.dispose();
  });

  it('supersedes an earlier request without losing edits', async () => {
    const state = setup();
    const first = state.guard.requestLeave(new AbortController().signal);
    const second = state.guard.requestLeave(new AbortController().signal);
    expect(await first).toBe(false);
    state.guard.discard();
    expect(await second).toBe(true);
    expect(state.discard).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('shares repeated requests with the same signal', async () => {
    const state = setup();
    const controller = new AbortController();
    const first = state.guard.requestLeave(controller.signal);
    expect(state.guard.requestLeave(controller.signal)).toBe(first);
    state.guard.keepEditing();
    expect(await first).toBe(false);
    state.dispose();
  });

  it('refuses a pending request when its owner is disposed', async () => {
    const state = setup();
    const leaving = state.guard.requestLeave();
    state.dispose();
    expect(await leaving).toBe(false);
    expect(state.guard.requestLeave()).toBe(false);
  });
});
