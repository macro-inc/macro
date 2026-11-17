import { ok } from 'neverthrow';
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
  it('retains confirmed data on a transient failure but clears unavailable or foreign-viewer data', () => {
    const fixture = createRoot((dispose) => {
      disposers.push(dispose);
      const record: SavedView = {
        id: 'view',
        ownerId: 'viewer',
        name: 'Saved view',
        revision: 1,
        sharedTeamId: null,
        config: { value: 1 },
      };
      const [data, setData] = createSignal<SavedView | null>(record);
      const [error, setError] = createSignal<unknown>();
      const [viewer, setViewer] = createSignal('viewer');
      const draft = createSavedViewDraft({
        source: {
          data,
          error,
          viewerId: () => 'viewer',
          loading: () => false,
          refresh: async () => {},
        },
        selectedId: () => 'view',
        viewerId: viewer,
        creating: () => false,
        capture: () => ok(1),
        defaults: () => ok(1),
        read: () => ({ config: 1, issues: [] }),
        decode: () => ok(1),
        equal: Object.is,
        apply: () => {},
        resetNew: () => {},
      });
      return { draft, record, setData, setError, setViewer };
    });
    expect(fixture.draft.view().kind).toBe('saved');
    fixture.setError(new Error('Network unavailable'));
    expect(fixture.draft.view().kind).toBe('saved');
    fixture.setData(null);
    expect(fixture.draft.view().kind).toBe('unavailable');
    fixture.setData(fixture.record);
    fixture.setViewer('another-viewer');
    expect(fixture.draft.view().kind).toBe('loading');
  });
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

  it('resets local edits to the latest authorized remote definition', () => {
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
          settings: { ...DEFAULT_PROJECT_SETTINGS },
        },
      };
      const [source, setSource] = createSignal(record);
      const [sourceViewer, setSourceViewer] = createSignal('viewer');
      const [settings, setSettings] = createStore({
        ...DEFAULT_PROJECT_SETTINGS,
      });
      const draft = createSavedViewDraft({
        source: {
          data: source,
          viewerId: sourceViewer,
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
      return {
        record,
        settings,
        setSettings,
        setSource,
        setSourceViewer,
        draft,
      };
    });
    fixture.setSettings('sort', 'created');
    const remote: SavedView = {
      ...fixture.record,
      revision: 3,
      config: {
        kind: 'projects',
        version: 1,
        scope: 'all',
        settings: { ...DEFAULT_PROJECT_SETTINGS, layout: 'gantt' },
      },
    };
    fixture.setSource(remote);
    fixture.setSource({ ...fixture.record, revision: 2 });
    expect(fixture.settings.layout).toBe('list');
    expect(fixture.draft.view()).toMatchObject({
      kind: 'saved',
      dirty: true,
      record: { revision: 1 },
    });

    fixture.draft.reset();
    expect(fixture.settings.layout).toBe('gantt');
    expect(fixture.settings.sort).toBe('updated');
    expect(fixture.draft.view()).toMatchObject({
      kind: 'saved',
      dirty: false,
      record: { revision: 3 },
    });

    // An older or differently scoped source must not replace that baseline.
    fixture.setSettings('sort', 'created');
    fixture.setSource(fixture.record);
    fixture.draft.reset();
    expect(fixture.settings.layout).toBe('gantt');
    fixture.setSourceViewer('another-viewer');
    fixture.setSource({
      ...remote,
      revision: 4,
      config: fixture.record.config,
    });
    fixture.draft.reset();
    expect(fixture.settings.layout).toBe('gantt');
    expect(fixture.draft.view()).toMatchObject({ record: { revision: 3 } });
  });
});
