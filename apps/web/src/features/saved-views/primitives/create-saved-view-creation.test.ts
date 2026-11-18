import deepEqual from 'fast-deep-equal';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { SavedView } from '../core/saved-view';
import { createSavedViewCreation } from './create-saved-view-creation';

const SAVED: SavedView = {
  id: 'existing',
  name: 'Existing',
  config: { filter: 'one' },
  ownerId: 'viewer',
  sharedTeamId: null,
  revision: 1,
};
function setup(kind = 'tasks') {
  return createRoot((dispose) => {
    const [viewer, setViewer] = createSignal<string | undefined>('viewer');
    const [config, setConfig] = createSignal<unknown>({ filter: '' });
    const [records, setRecords] = createSignal<readonly SavedView[]>([SAVED]);
    const creation = createSavedViewCreation({
      kind,
      viewerId: viewer,
      capture: config,
      list: records,
      equal: deepEqual,
    });
    return { creation, setViewer, setConfig, setRecords, dispose };
  });
}

describe('new saved-view lifecycle and ordering', () => {
  it('gives each creation a fresh identity without changing saved records', () => {
    const state = setup();
    const first = state.creation.begin(SAVED.config, 'Copy', true);
    const second = state.creation.begin({ filter: '' }, 'New view');
    expect(second.id).not.toBe(first.id);
    expect(state.creation.current()?.id).toBe(second.id);
    expect(state.creation.items()).toEqual([SAVED]);
    expect(state.creation.entries().map((row) => row.kind)).toEqual([
      'saved',
      'draft',
    ]);
    expect(state.creation.entries().at(-1)).toEqual({
      kind: 'draft',
      draft: second,
    });
    expect(SAVED.name).toBe('Existing');
    state.dispose();
  });

  it('keeps each draft in its consumer kind', () => {
    const tasks = setup('tasks');
    const projects = setup('projects');
    const taskDraft = tasks.creation.begin({}, 'New view');
    const projectDraft = projects.creation.begin({}, 'New view');
    expect(taskDraft.kind).toBe('tasks');
    expect(projectDraft.kind).toBe('projects');
    expect(taskDraft.id).not.toBe(projectDraft.id);
    tasks.dispose();
    projects.dispose();
  });

  it('does not retain a saved record when its list arrived before confirmation', () => {
    const state = setup();
    const draft = state.creation.begin({}, 'New view');
    const confirmed = { ...SAVED, id: draft.id };
    state.setRecords([SAVED, confirmed]);
    expect(state.creation.confirm(confirmed)).toBe(true);
    state.setRecords([SAVED]);
    expect(state.creation.items()).toEqual([SAVED]);
    state.dispose();
  });

  it('appends the saved draft and does not resurrect it after list removal', () => {
    const state = setup();
    const draft = state.creation.begin({}, 'New view');
    const confirmed = { ...SAVED, id: draft.id, name: 'New view' };
    expect(state.creation.confirm(confirmed)).toBe(true);
    expect(state.creation.items()?.map((record) => record.id)).toEqual([
      'existing',
      draft.id,
    ]);
    expect(state.creation.current()).toBeUndefined();
    state.setRecords([SAVED, confirmed]);
    state.setRecords([SAVED]);
    expect(state.creation.items()).toEqual([SAVED]);
    state.dispose();
  });

  it('distinguishes clean drafts from settings and metadata edits', () => {
    const state = setup();
    state.creation.begin({ filter: '' }, 'New view');
    expect(state.creation.dirty()).toBe(false);
    state.setConfig({ filter: 'changed' });
    expect(state.creation.dirty()).toBe(true);
    state.setConfig({ filter: '' });
    state.creation.update({ name: 'Named view' });
    expect(state.creation.dirty()).toBe(true);
    state.creation.update({ name: 'New view', sharedTeamId: 'team' });
    expect(state.creation.dirty()).toBe(true);
    state.creation.discard();
    expect(state.creation.current()).toBeUndefined();
    expect(state.creation.dirty()).toBe(false);
    state.dispose();
  });

  it('retains the draft after a failed save', async () => {
    const state = setup();
    const draft = state.creation.begin({}, 'New view');
    state.creation.registerSave(async () => {
      throw new Error('Offline');
    });
    await expect(state.creation.save()).rejects.toThrow('Offline');
    expect(state.creation.current()?.id).toBe(draft.id);
    expect(state.creation.saving()).toBe(false);
    state.dispose();
  });

  it('does not apply a pending save to another draft or account', async () => {
    const state = setup();
    const result = Promise.withResolvers<SavedView>();
    const save = vi.fn(() => result.promise);
    state.creation.registerSave(save);
    const first = state.creation.begin({}, 'First');
    const pending = state.creation.save();
    const second = state.creation.begin({}, 'Second');
    result.resolve({ ...SAVED, id: first.id });
    await pending;
    expect(state.creation.current()?.id).toBe(second.id);
    state.setViewer('another-viewer');
    expect(state.creation.current()).toBeUndefined();
    state.dispose();
  });
});
