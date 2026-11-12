import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_SETTINGS } from '../../projects/core/project';
import {
  captureProjectSavedView,
  decodeProjectSavedView,
  projectSavedViewsEqual,
  readProjectSavedView,
} from '../../projects/core/project-saved-view';
import type { SavedView } from '../core/saved-view';
import { createSavedViewDraft } from './create-saved-view-draft';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

describe('shared saved-view draft', () => {
  it('retains concurrent edits and rejects older confirmations for project definitions', () => {
    const fixture = createRoot((dispose) => {
      disposers.push(dispose);
      const record: SavedView = {
        id: 'view',
        ownerId: 'viewer',
        name: 'Project view',
        revision: 1,
        sharedTeamId: null,
        config: {
          kind: 'projects',
          version: 1,
          scope: 'all',
          settings: { ...DEFAULT_PROJECT_SETTINGS, layout: 'gantt' },
        },
      };
      const [source, setSource] = createSignal(record);
      const [settings, setSettings] = createStore({
        ...DEFAULT_PROJECT_SETTINGS,
      });
      const draft = createSavedViewDraft({
        source: {
          data: source,
          viewerId: () => 'viewer',
          error: () => undefined,
          loading: () => false,
          refresh: async () => {},
        },
        viewerId: () => 'viewer',
        selectedId: () => 'view',
        creating: () => false,
        capture: () => captureProjectSavedView(settings, 'all'),
        defaults: () =>
          captureProjectSavedView(DEFAULT_PROJECT_SETTINGS, 'all'),
        read: readProjectSavedView,
        decode: decodeProjectSavedView,
        equal: projectSavedViewsEqual,
        apply: (config) => setSettings(config.settings),
        resetNew: () => setSettings(DEFAULT_PROJECT_SETTINGS),
      });
      return { record, settings, setSettings, setSource, draft };
    });
    expect(fixture.settings.layout).toBe('gantt');
    fixture.setSettings('sort', 'created');
    const submitted = fixture.draft.capture();
    if (submitted.isErr()) throw new Error(submitted.error);
    const releaseFirst = fixture.draft.retain();
    const releaseSecond = fixture.draft.retain();
    releaseFirst();
    fixture.setSettings('groupBy', 'none');
    const confirmed = {
      ...fixture.record,
      revision: 2,
      config: submitted.value,
    };
    fixture.setSource(confirmed);
    expect(fixture.settings.groupBy).toBe('none');
    expect(fixture.draft.acceptConfirmed(confirmed)).toBe(true);
    expect(fixture.draft.acceptConfirmed(fixture.record)).toBe(false);
    expect(
      fixture.draft.acceptConfirmed({ ...confirmed, id: 'another-view' })
    ).toBe(false);
    expect(fixture.draft.view()).toMatchObject({
      kind: 'saved',
      record: { id: 'view' },
    });
    releaseSecond();
    expect(fixture.draft.view()).toMatchObject({ kind: 'saved', dirty: true });
    fixture.draft.reset();
    expect(fixture.settings.sort).toBe('created');
    expect(fixture.settings.groupBy).toBe('status');
    expect(fixture.draft.view()).toMatchObject({ kind: 'saved', dirty: false });
  });
});
