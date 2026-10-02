import { ThrownResultError } from '@core/util/result';
import { renderHook, waitFor } from '@solidjs/testing-library';
import { batch, createEffect, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewHost } from '../context/review-context';
import type { ReviewData, ReviewSource, ReviewState } from '../core/source';
import { createReview } from './create-review';

const at = (line: number) => ({ path: 'main.rs', side: 'new' as const, line });
function snapshot(number = 1): ReviewState {
  return {
    id: 'review',
    title: 'Test',
    summary: '',
    repository: 'repo',
    source: 'workspace',
    revisions: [
      {
        number,
        comparison: {},
        files: [
          {
            path: 'main.rs',
            status: 'modified',
            added: 1,
            removed: 0,
            content: 'hash',
          },
        ],
        symbols: [],
      },
    ],
    tour: [],
    annotations: [],
    threads: [],
    anchors: [
      {
        id: 'citation',
        revision: 1,
        status: 'current',
        original: at(12),
        current: at(12),
        excerpt: ['code'],
      },
    ],
  };
}
function setup(initial?: ReviewState, pinned?: number, withCitation = true) {
  const [data, setData] = createSignal(initial);
  const [revision, setRevision] = createSignal(pinned);
  const [navigation, setNavigation] = createSignal(0);
  const [target, setTarget] = createSignal(
    withCitation ? 'citation' : undefined
  );
  const [canEdit, setCanEdit] = createSignal(true);
  const [filePhase, setFilePhase] = createSignal<'loading' | 'ready' | 'error'>(
    'ready'
  );
  const [phase, setPhase] = createSignal<'loading' | 'ready' | 'error'>(
    'ready'
  );
  const manifest: ReviewData<ReviewState> = {
    value: data,
    phase,
    error: () => undefined,
    refresh: async () => data(),
  };
  const source: ReviewSource = {
    manifest,
    loadedRevision: () => data()?.revisions.at(-1)?.number,
    capturing: () => false,
    commenting: () => false,
    capture: async () => {
      setData(snapshot());
      return {
        reviewId: 'review',
        revision: 1,
        url: 'https://macro.com/review',
      };
    },
    comment: async () => ({
      reviewId: 'review',
      revision: 1,
      url: 'https://macro.com/review',
    }),
    resolve: async () => {},
  };
  const host: ReviewHost = {
    createSource: () => source,
    createFile: () => ({
      value: () => undefined,
      phase: filePhase,
      error: () => undefined,
      refresh: async () => undefined,
    }),
    sessionId: () => 'session',
    canEdit,
    userId: () => 'user',
    displayName: (id) => id,
    savedNotes: () => [],
    open: () => true,
    available: () => true,
    reviewId: () => 'review',
    revision,
    navigation,
    target,
    thread: () => undefined,
    selectRevision: (number) =>
      batch(() => {
        setRevision(number);
        setTarget(undefined);
      }),
    show: () => {},
    back: () => {},
    openLink: () => {
      setNavigation((n) => n + 1);
      return true;
    },
  };
  return {
    host,
    source,
    setData,
    setPhase,
    setCanEdit,
    setFilePhase,
    setTarget,
    model: createReview(host),
  };
}

describe('review navigation and live revisions', () => {
  const withGraph = () => ({
    ...snapshot(),
    graph: {
      title: 'Request flow',
      nodes: [{ id: 'main', title: 'Main', location: at(4) }],
      edges: [],
    },
    tour: [
      {
        title: 'Reader',
        description: '',
        note: '',
        paths: ['main.rs'],
        focus: at(7),
      },
    ],
  });
  it('starts the tour on the overview and keeps code drafts when returning to it', () => {
    const { result, cleanup } = renderHook(() => setup(withGraph(), 1, false));
    expect(result.model.overview()).toBe(true);
    result.model.chooseChapter(0);
    expect(result.model.overview()).toBe(false);
    expect(result.model.target()).toEqual(at(7));
    result.model.begin(at(9));
    result.model.setDraft('Keep this comment');
    result.model.showOverview();
    expect(result.model.overview()).toBe(true);
    expect(result.model.draft()).toBe('Keep this comment');
    expect(result.model.composing()).toEqual(at(9));
    result.model.navigate(at(4));
    expect(result.model.overview()).toBe(false);
    expect(result.model.target()).toEqual(at(4));
    cleanup();
  });
  it('opens citations directly in code, including after visiting the overview', () => {
    const { result, cleanup } = renderHook(() => setup(withGraph(), 1));
    expect(result.model.overview()).toBe(false);
    expect(result.model.target()).toEqual(at(12));
    result.model.showOverview();
    expect(result.model.overview()).toBe(true);
    result.host.openLink('same citation');
    expect(result.model.overview()).toBe(false);
    expect(result.model.target()).toEqual(at(12));
    cleanup();
  });
  it('opens the corner map from a node and follows its component across code navigation', () => {
    const data = withGraph();
    data.graph.nodes.push({
      id: 'other',
      title: 'Other',
      location: { ...at(4), path: 'other.rs' },
    });
    const { result, cleanup } = renderHook(() => setup(data, 1, false));
    expect(result.model.mapOpen()).toBe(false);
    result.model.navigate(at(4), 'main');
    expect(result.model.mapOpen()).toBe(true);
    expect(result.model.activeGraphNode()).toBe('main');
    result.model.navigate({ ...at(4), path: 'other.rs' }, 'other');
    expect(result.model.activeGraphNode()).toBe('other');
    result.model.navigate({ ...at(4), path: 'unrelated.rs' });
    expect(result.model.activeGraphNode()).toBeUndefined();
    result.model.closeMap();
    expect(result.model.mapOpen()).toBe(false);
    cleanup();
  });
  it('preserves the chosen tour page across captures and skips missing graphs', async () => {
    const data = withGraph();
    const { result, cleanup } = renderHook(() => setup(data, 1, false));
    result.setData({
      ...data,
      revisions: [...data.revisions, ...snapshot(2).revisions],
    });
    await waitFor(() => expect(result.model.currentRevision()).toBe(2));
    expect(result.model.overview()).toBe(true);
    result.model.chooseChapter(0);
    result.setData({
      ...data,
      revisions: [
        ...data.revisions,
        ...snapshot(2).revisions,
        ...snapshot(3).revisions,
      ],
    });
    await waitFor(() => expect(result.model.currentRevision()).toBe(3));
    expect(result.model.overview()).toBe(false);
    result.model.showOverview();
    result.setData({ ...snapshot(3), tour: data.tour });
    expect(result.model.overview()).toBe(false);
    cleanup();
  });
  it('leaves the overview for an incoming citation even within the same revision', () => {
    const { result, cleanup } = renderHook(() => setup(withGraph(), 1, false));
    expect(result.model.overview()).toBe(true);
    result.setTarget('citation');
    expect(result.model.overview()).toBe(false);
    expect(result.model.target()).toEqual(at(12));
    cleanup();
  });
  it('reopens an identical citation after local navigation', () => {
    const { result, cleanup } = renderHook(() => setup(snapshot(), 1));
    expect(result.model.target()).toEqual(at(12));
    result.model.navigate(at(500));
    expect(result.model.target()).toEqual(at(500));
    result.host.openLink('same citation');
    expect(result.model.target()).toEqual(at(12));
    cleanup();
  });
  it('follows new captures after the initial publication', async () => {
    const { result, cleanup } = renderHook(() =>
      setup(undefined, undefined, false)
    );
    await result.model.capture();
    await waitFor(() => expect(result.host.revision()).toBe(1));
    result.setData({
      ...snapshot(),
      revisions: [...snapshot().revisions, ...snapshot(2).revisions],
    });
    await waitFor(() => expect(result.model.currentRevision()).toBe(2));
    cleanup();
  });
  it('pins the first successful retry after an initial read error', async () => {
    const { result, cleanup } = renderHook(() => setup());
    result.setPhase('error');
    expect(result.host.revision()).toBeUndefined();
    result.setData(snapshot(3));
    result.setPhase('ready');
    await waitFor(() => expect(result.host.revision()).toBe(3));
    cleanup();
  });
  it('resumes live following after a draft and preserves explicit historical navigation', async () => {
    const { result, cleanup } = renderHook(() => setup(snapshot(), 1, false));
    result.model.begin(at(2));
    result.model.setDraft('Keep this draft on revision 1');
    result.setData({
      ...snapshot(),
      revisions: [...snapshot().revisions, ...snapshot(2).revisions],
    });
    expect(result.model.currentRevision()).toBe(1);
    result.model.setDraft('');
    result.model.cancel();
    await waitFor(() => expect(result.model.currentRevision()).toBe(2));
    result.setData({
      ...snapshot(3),
      revisions: [
        ...snapshot().revisions,
        ...snapshot(2).revisions,
        ...snapshot(3).revisions,
      ],
    });
    await waitFor(() => expect(result.model.currentRevision()).toBe(3));
    result.model.chooseRevision(1);
    result.setData({
      ...snapshot(4),
      revisions: [
        ...snapshot().revisions,
        ...snapshot(2).revisions,
        ...snapshot(3).revisions,
        ...snapshot(4).revisions,
      ],
    });
    await waitFor(() => expect(result.model.currentRevision()).toBe(1));
    cleanup();
  });
  it('keeps the viewport when selecting visible code or switching revisions', () => {
    const { result, cleanup } = renderHook(() => setup(snapshot(), 1));
    const sequence = result.model.sequence();
    result.model.begin({ ...at(500), endLine: 504 });
    expect(result.model.sequence()).toBe(sequence);
    expect(result.model.composing()).toEqual({ ...at(500), endLine: 504 });
    result.model.chooseRevision(2);
    expect(result.model.sequence()).toBe(sequence);
    expect(result.model.target()).toEqual({ ...at(500), endLine: 504 });
    result.model.navigate(at(12));
    expect(result.model.sequence()).not.toBe(sequence);
    cleanup();
  });
  it('tracks a file reached by scrolling without issuing a navigation or losing a draft', () => {
    const data = snapshot();
    data.revisions[0].files.push({
      path: 'deleted.rs',
      status: 'deleted',
      added: 0,
      removed: 10,
      content: 'old',
    });
    const { result, cleanup } = renderHook(() => setup(data, 1));
    result.model.begin(at(12));
    result.model.setDraft('Keep this draft');
    const sequence = result.model.sequence();
    result.model.observeFile('deleted.rs');
    expect(result.model.target()).toEqual({
      path: 'deleted.rs',
      side: 'old',
      line: 1,
    });
    expect(result.model.sequence()).toBe(sequence);
    expect(result.model.composing()).toEqual(at(12));
    expect(result.model.draft()).toBe('Keep this draft');
    result.model.observeFile('missing.rs');
    expect(result.model.target()?.path).toBe('deleted.rs');
    cleanup();
  });
  it('preserves the code position when the host publishes a revision route asynchronously', async () => {
    const navigations: string[] = [];
    const { result, cleanup } = renderHook(() => {
      const value = setup(withGraph(), 1, false);
      createEffect(() => navigations.push(value.model.sequence()));
      return value;
    });
    const selectRevision = result.host.selectRevision;
    result.host.selectRevision = (number) =>
      queueMicrotask(() => selectRevision(number));
    result.model.navigate(at(25));
    const sequence = result.model.sequence();
    const count = navigations.length;
    result.model.chooseRevision(2);
    expect(result.model.target()).toEqual(at(25));
    expect(result.model.overview()).toBe(false);
    expect(result.model.sequence()).toBe(sequence);
    expect(navigations).toHaveLength(count);
    await waitFor(() => expect(result.model.currentRevision()).toBe(2));
    expect(result.model.target()).toEqual(at(25));
    expect(result.model.overview()).toBe(false);
    expect(result.model.sequence()).toBe(sequence);
    expect(navigations).toHaveLength(count);
    cleanup();
  });
  it('quietly retries background capture contention but reports other failures', async () => {
    const { result, cleanup } = renderHook(() => setup(snapshot(), 1, false));
    const conflict = new ThrownResultError([
      { code: 'CONFLICT', message: 'Another capture is running' },
    ]);
    const capture = vi.spyOn(result.source, 'capture');
    capture.mockRejectedValueOnce(conflict);
    await result.model.capture(true);
    expect(result.model.notice()).toBe('');
    capture.mockRejectedValueOnce(new Error('Workspace unavailable'));
    await result.model.capture(true);
    expect(result.model.notice()).toBe('Workspace unavailable');
    capture.mockRejectedValueOnce(conflict);
    await result.model.capture();
    expect(result.model.notice()).toBe('Another capture is running');
    cleanup();
  });
  it('keeps the file list during a revision load and blocks comments against retained code', () => {
    const { result, cleanup } = renderHook(() => setup(snapshot(), 1));
    const manifest = result.model.manifest();
    result.setPhase('loading');
    result.model.chooseRevision(2);
    expect(result.model.manifest()).toBe(manifest);
    expect(result.model.loading()).toBe(true);
    result.model.begin(at(12));
    expect(result.model.composing()).toBeUndefined();
    result.setData(snapshot(2));
    result.setPhase('ready');
    expect(result.model.manifest()?.number).toBe(2);
    expect(result.model.loading()).toBe(false);
    cleanup();
  });
  it('retains the loaded manifest before the query reports its pending state', () => {
    const { result, cleanup } = renderHook(() => setup(snapshot(), 1));
    result.model.chooseRevision(2);
    expect(result.source.manifest.phase()).toBe('ready');
    expect(result.model.manifest()?.number).toBe(1);
    expect(result.model.loading()).toBe(true);
    result.setData(snapshot(2));
    expect(result.model.manifest()?.number).toBe(2);
    expect(result.model.loading()).toBe(false);
    cleanup();
  });
  it('preserves a draft but blocks mutations after edit permission is revoked', async () => {
    const data = snapshot();
    data.threads.push({
      id: 'thread',
      anchor: 'citation',
      resolved: false,
      messages: [],
    });
    const { result, cleanup } = renderHook(() => setup(data, 1));
    const comment = vi.spyOn(result.source, 'comment');
    const capture = vi.spyOn(result.source, 'capture');
    const resolve = vi.spyOn(result.source, 'resolve');
    result.model.begin(at(12));
    result.model.setDraft('Keep this draft');
    result.setCanEdit(false);
    await result.model.send();
    await result.model.capture();
    await result.model.resolve('thread');
    expect(comment).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(result.model.draft()).toBe('Keep this draft');
    expect(result.model.composing()).toEqual(at(12));
    cleanup();
  });
  it('finishes loading an empty comparison without waiting for a disabled file query', () => {
    const data = snapshot();
    data.revisions[0].files = [];
    const { result, cleanup } = renderHook(() => setup(data, 1));
    result.setFilePhase('loading');
    expect(result.model.loading()).toBe(false);
    expect(result.model.ready()).toBe(false);
    result.model.begin(at(12));
    expect(result.model.composing()).toBeUndefined();
    cleanup();
  });
});
