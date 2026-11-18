import type { PaneId } from '@app/lib/split-router/panes/types';
import type { LeaveGuardContext } from '@app/lib/split-router/router/types';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createDraftLeave } from './create-draft-leave';

function setup(dirtyInitially = true) {
  return createRoot((dispose) => {
    const [dirty, setDirty] = createSignal(dirtyInitially);
    const [identity, setIdentity] = createSignal<unknown>('draft');
    const [scope, setScope] = createSignal('viewer');
    const discard = vi.fn(() => {
      setDirty(false);
      setIdentity(undefined);
    });
    const save = vi.fn(async () => {
      setDirty(false);
    });
    const leave = createDraftLeave({
      identity,
      scope,
      dirty,
      busy: () => false,
      save,
      discard,
      saveError: 'Failed',
    });
    const commits: (() => void)[] = [];
    const context: LeaveGuardContext = {
      pane: 'pane' as PaneId,
      from: {
        id: 'entry',
        location: { route: { matches: [{ id: 'tasks', params: {} }] } },
      },
      cause: 'navigate',
      signal: new AbortController().signal,
      onCommit: (callback) => commits.push(callback),
    };
    return {
      leave,
      discard,
      save,
      commits,
      context,
      dispose,
      setIdentity,
      setDirty,
      setScope,
    };
  });
}

describe('draft leave navigation', () => {
  it('rejects a decision after the account changes', async () => {
    const state = setup();
    const decision = state.leave.decide(state.context);
    state.setScope('another-viewer');
    state.leave.discard();
    expect(await decision).toBe(false);
    expect(state.discard).not.toHaveBeenCalled();
    state.dispose();
  });

  it('does not save after an account switches away and back', async () => {
    const state = setup();
    const decision = state.leave.decide(state.context);
    state.setScope('another-viewer');
    state.setScope('viewer');
    await state.leave.save();
    expect(await decision).toBe(false);
    expect(state.save).not.toHaveBeenCalled();
    state.dispose();
  });

  it('runs only the first action after repeated clicks', async () => {
    const state = setup();
    const first = vi.fn();
    const second = vi.fn();
    state.leave.run(first);
    state.leave.run(second);
    state.leave.discard();
    await Promise.resolve();
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    state.dispose();
  });

  it('allows a confirmed save to retire its own draft', async () => {
    const state = setup();
    state.save.mockImplementationOnce(async () => {
      state.setDirty(false);
      state.setIdentity(undefined);
    });
    const decision = state.leave.decide(state.context);
    await state.leave.save();
    expect(await decision).toBe(true);
    expect(state.save).toHaveBeenCalledOnce();
    state.dispose();
  });
  it('does not discard when another guard refuses the navigation', async () => {
    const state = setup();
    const decision = state.leave.decide(state.context);
    state.leave.discard();
    expect(await decision).toBe(true);
    expect(state.discard).not.toHaveBeenCalled();
    state.dispose();
  });

  it('discards only after the router commits', async () => {
    const state = setup();
    const decision = state.leave.decide(state.context);
    state.leave.discard();
    expect(await decision).toBe(true);
    state.commits.forEach((commit) => commit());
    expect(state.discard).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('does not discard a different draft after an account or draft change', async () => {
    const state = setup();
    const decision = state.leave.decide(state.context);
    state.leave.discard();
    await decision;
    state.setIdentity('another-draft');
    state.commits.forEach((commit) => commit());
    expect(state.discard).not.toHaveBeenCalled();
    state.dispose();
  });

  it('leaves a clean draft without a confirmation and removes it on commit', () => {
    const state = setup(false);
    expect(state.leave.decide(state.context)).toBe(true);
    expect(state.leave.open()).toBe(false);
    expect(state.discard).not.toHaveBeenCalled();
    state.commits.forEach((commit) => commit());
    expect(state.discard).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('blocks local selection changes when the user cancels', async () => {
    const state = setup();
    const action = vi.fn();
    state.leave.run(action);
    state.leave.keepEditing();
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    state.dispose();
  });

  it('discards before applying a local selection change', async () => {
    const state = setup();
    const action = vi.fn(() => expect(state.discard).toHaveBeenCalledOnce());
    state.leave.run(action);
    state.leave.discard();
    await Promise.resolve();
    await Promise.resolve();
    expect(action).toHaveBeenCalledOnce();
    state.dispose();
  });

  it('warns before window reload only while dirty', async () => {
    const state = setup();
    await Promise.resolve();
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    state.setDirty(false);
    await Promise.resolve();
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    state.dispose();
  });
});
