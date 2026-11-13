import type { DraftJob } from '@service-scheduled-action/generated/schemas';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createDraftsOnScreen } from '../context/drafts-on-screen';
import { createDraftJobDialog } from './draft-job-dialog';

const REQUEST = 'When an invoice arrives, label it Finance.';

function drafting(id: string, stage = 'started'): DraftJob {
  return {
    id,
    state: 'drafting',
    request: { kind: 'routine', description: `${REQUEST} (${id})` },
    progress: { stage },
    createdAt: '2026-11-12T10:00:00Z',
  } as DraftJob;
}

function ready(id: string): DraftJob {
  return {
    ...drafting(id),
    state: 'ready',
    draft: { outcome: 'routine', name: 'Invoices' },
    finishedAt: '2026-11-12T10:00:30Z',
  } as DraftJob;
}

function failed(id: string, message = 'There’s no label named Finance.') {
  return {
    ...drafting(id),
    state: 'failed',
    message,
    created: [],
    finishedAt: '2026-11-12T10:00:30Z',
  } as DraftJob;
}

/** The dialog over a fake list of drafts, open until `dispose` runs. */
function openDialog(
  initial: DraftJob[] = [],
  options: {
    start?: (description: string) => Promise<DraftJob | string>;
    open?: () => string | undefined;
  } = {}
) {
  const [jobs, setJobs] = createSignal<readonly DraftJob[]>(initial);
  const [loaded] = createSignal(true);
  const onScreen = createDraftsOnScreen();
  const open = vi.fn(options.open ?? (() => undefined));
  const discard = vi.fn((id: string) =>
    setJobs((list) => list.filter((job) => job.id !== id))
  );
  const start = vi.fn(options.start ?? (async () => drafting('started')));
  const report = vi.fn((_job: DraftJob) => {});
  return createRoot((dispose) => {
    const dialog = createDraftJobDialog({
      jobs,
      loaded,
      onScreen,
      start,
      open,
      discard,
      report,
    });
    return {
      dialog,
      setJobs,
      onScreen,
      open,
      discard,
      report,
      start,
      dispose,
    };
  });
}

describe('createDraftJobDialog', () => {
  it('shows the newest draft under way, and reports it on screen', () => {
    const { dialog, onScreen, dispose } = openDialog([
      drafting('newer', 'writing'),
      drafting('older'),
    ]);
    const view = dialog.view();
    expect(view.kind).toBe('drafting');
    expect(view.kind === 'drafting' && view.job.id).toBe('newer');
    expect(onScreen.isShown('newer')).toBe(true);
    // Not on screen: the pill still reports it.
    expect(onScreen.isShown('older')).toBe(false);
    dispose();
    expect(onScreen.isShown('newer')).toBe(false);
  });

  it('opens the draft it shows once that draft is ready', () => {
    const { dialog, setJobs, open, dispose } = openDialog([
      drafting('a', 'writing'),
    ]);
    setJobs([ready('a')]);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', state: 'ready' }),
      'dialog'
    );
    // Its progress stays while its page opens.
    expect(dialog.view().kind).toBe('drafting');
    dispose();
  });

  it('puts the request back with why, when the ready draft can’t open', () => {
    const { dialog, setJobs, dispose } = openDialog([drafting('a')], {
      open: () => 'That draft has no steps.',
    });
    setJobs([ready('a')]);
    expect(dialog.view()).toMatchObject({
      kind: 'describe',
      restored: {
        description: `${REQUEST} (a)`,
        error: 'That draft has no steps.',
      },
    });
    dispose();
  });

  it('puts the request back with why it failed, and discards the failure', () => {
    const { dialog, setJobs, discard, open, dispose } = openDialog([
      drafting('a'),
    ]);
    setJobs([failed('a')]);
    expect(open).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('a');
    expect(dialog.view()).toMatchObject({
      kind: 'describe',
      restored: {
        description: `${REQUEST} (a)`,
        error: 'There’s no label named Finance.',
      },
    });
    dispose();
  });

  it('cancels the draft on screen and keeps its request in the box', () => {
    const { dialog, discard, dispose } = openDialog([drafting('a')]);
    dialog.cancel();
    expect(discard).toHaveBeenCalledWith('a');
    expect(dialog.view()).toEqual({
      kind: 'describe',
      ready: undefined,
      restored: { description: `${REQUEST} (a)` },
    });
    dispose();
  });

  it('goes back to the box when its draft is discarded elsewhere', () => {
    const { dialog, setJobs, open, dispose } = openDialog([drafting('a')]);
    setJobs([]);
    expect(open).not.toHaveBeenCalled();
    expect(dialog.view()).toEqual({
      kind: 'describe',
      ready: undefined,
      restored: undefined,
    });
    dispose();
  });

  it('offers a draft that finished while it was closed', () => {
    const { dialog, onScreen, open, discard, dispose } = openDialog([
      ready('done'),
    ]);
    const view = dialog.view();
    expect(view.kind === 'describe' && view.ready?.id).toBe('done');
    expect(onScreen.wasSeen('done')).toBe(true);
    expect(onScreen.isShown('done')).toBe(true);
    dialog.review();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'done' }),
      'banner'
    );
    dialog.discardReady();
    expect(discard).toHaveBeenCalledWith('done');
    dispose();
  });

  it('puts back a request that failed while it was closed', () => {
    const { dialog, discard, dispose } = openDialog([failed('gone')]);
    expect(discard).toHaveBeenCalledWith('gone');
    expect(dialog.view()).toMatchObject({
      kind: 'describe',
      restored: { error: 'There’s no label named Finance.' },
    });
    dispose();
  });

  it('waits for the list before putting back a failed request', () => {
    const [jobs, setJobs] = createSignal<readonly DraftJob[]>([]);
    const [loaded, setLoaded] = createSignal(false);
    const discard = vi.fn();
    const { dialog, dispose } = createRoot((dispose) => ({
      dialog: createDraftJobDialog({
        jobs,
        loaded,
        onScreen: createDraftsOnScreen(),
        start: async () => 'unused',
        open: () => undefined,
        discard,
        report: () => {},
      }),
      dispose,
    }));
    expect(dialog.view()).toMatchObject({ restored: undefined });
    setJobs([failed('late')]);
    expect(discard).not.toHaveBeenCalled();
    setLoaded(true);
    expect(discard).toHaveBeenCalledWith('late');
    expect(dialog.view()).toMatchObject({
      restored: { description: `${REQUEST} (late)` },
    });
    dispose();
  });

  it('answers why a request didn’t start, or failed at once', async () => {
    const starts: (DraftJob | string)[] = [
      'Too many routines are drafting.',
      failed('refused', 'Describe something a routine can do.'),
    ];
    const { dialog, discard, dispose } = openDialog([], {
      start: async () => starts.shift() ?? 'none',
    });
    await expect(dialog.describe(REQUEST)).resolves.toBe(
      'Too many routines are drafting.'
    );
    await expect(dialog.describe(REQUEST)).resolves.toBe(
      'Describe something a routine can do.'
    );
    expect(discard).toHaveBeenCalledWith('refused');
    dispose();
  });

  it('opens a draft a resent start finds already finished', async () => {
    const { dialog, open, dispose } = openDialog([], {
      start: async () => ready('ran'),
    });
    await expect(dialog.describe(REQUEST)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ran' }),
      'dialog'
    );
    dispose();
  });

  it('stops reporting a draft on screen once a newer one takes its place', () => {
    const { setJobs, onScreen, dispose } = openDialog([drafting('a')]);
    // Started in another tab: the newer draft is the one shown.
    setJobs([drafting('b'), drafting('a')]);
    expect(onScreen.isShown('b')).toBe(true);
    expect(onScreen.isShown('a')).toBe(false);
    // So the pill and its toast report it when it's ready.
    setJobs([drafting('b'), ready('a')]);
    expect(onScreen.isShown('a')).toBe(false);
    dispose();
  });

  it('hands a start that finishes after it closed to the pill and toasts', async () => {
    const ran = Promise.withResolvers<DraftJob>();
    const refused = Promise.withResolvers<DraftJob>();
    const answers = [ran.promise, refused.promise];
    const { dialog, open, discard, report, dispose } = openDialog([], {
      start: async () => (await answers.shift()) ?? 'none',
    });
    const first = dialog.describe(REQUEST);
    const second = dialog.describe(REQUEST);
    dispose();
    ran.resolve(ready('ran'));
    refused.resolve(failed('refused'));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(report.mock.calls.map(([job]) => job.id)).toEqual([
      'ran',
      'refused',
    ]);
  });
});
