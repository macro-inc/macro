import type { DraftJob } from '@service-scheduled-action/generated/schemas';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { DraftsOnScreen } from '../context/drafts-on-screen';

type DraftingJob = Extract<DraftJob, { state: 'drafting' }>;
type ReadyJob = Extract<DraftJob, { state: 'ready' }>;

/** A request back in the describe box: after a cancel, or with why it failed. */
export type RestoredRequest = { description: string; error?: string };

/** What New routine shows: a draft under way, or the describe box. */
export type DraftJobDialogView =
  | { kind: 'drafting'; job: DraftingJob }
  | {
      kind: 'describe';
      /** A finished draft waiting to be opened. */
      ready?: ReadyJob;
      restored?: RestoredRequest;
    };

/**
 * New routine's side of a background draft. It shows the newest draft
 * under way and opens it when it's ready, while the dialog is open; once
 * the dialog closes the draft carries on, and the app's pill and toasts
 * report it. Opened again, it shows a draft still under way, offers one
 * that finished, or puts a failed request back with why it failed.
 */
export function createDraftJobDialog(options: {
  jobs: Accessor<readonly DraftJob[]>;
  /** Whether `jobs` has been read; empty until then. */
  loaded: Accessor<boolean>;
  onScreen: DraftsOnScreen;
  /** Start drafting; answers the job, or why it didn't start. */
  start(description: string): Promise<DraftJob | string>;
  /** Open a finished draft; answers why it couldn't, if it couldn't. */
  open(job: ReadyJob, from: 'dialog' | 'banner'): string | undefined;
  discard(id: string): void;
  /** Hand a finished draft to the app's pill and toasts. */
  report(job: DraftJob): void;
}) {
  // The drafts this dialog shows under way, and those it showed until they
  // finished: it reports them while it's open, so nothing else does.
  const [watched, setWatched] = createSignal<readonly string[]>([]);
  // A draft that finished on screen stays shown while its page opens.
  const [opening, setOpening] = createSignal<DraftingJob>();
  const [restored, setRestored] = createSignal<RestoredRequest>();

  const drafting = () =>
    options.jobs().find((job): job is DraftingJob => job.state === 'drafting');
  const ready = () =>
    options.jobs().find((job): job is ReadyJob => job.state === 'ready');
  const banner = () => (opening() || drafting() ? undefined : ready());

  const openReady = (job: ReadyJob, from: 'dialog' | 'banner') => {
    const error = options.open(job, from);
    if (!error) return;
    setOpening(undefined);
    setRestored({ description: job.request.description, error });
  };

  const fail = (job: DraftJob, error: string) => {
    options.discard(job.id);
    setRestored({ description: job.request.description, error });
  };

  // A draft finishing on screen: open it, or put its request back with why
  // it failed. One cancelled or discarded elsewhere just leaves.
  const settle = (job: DraftJob, shown: DraftingJob) =>
    match(job)
      .with({ state: 'ready' }, (finished) => {
        setOpening(shown);
        openReady(finished, 'dialog');
      })
      .with({ state: 'failed' }, (failed) => fail(failed, failed.message))
      .with({ state: 'drafting' }, () => undefined)
      .exhaustive(() => undefined);

  createEffect(
    on(drafting, (job, previous) => {
      if (job && !watched().includes(job.id)) {
        setWatched((list) => [...list, job.id]);
      }
      if (!previous || previous.id === job?.id) return;
      const latest = options.jobs().find((each) => each.id === previous.id);
      if (latest?.state === 'drafting') {
        // A newer draft took its place: the pill and toasts report it now.
        setWatched((list) => list.filter((id) => id !== previous.id));
        return;
      }
      if (latest) settle(latest, previous);
    })
  );

  // Opened after a draft failed: its request comes back, with why.
  createEffect(
    on(options.loaded, (loaded) => {
      if (!loaded || drafting() || restored()) return;
      const failed = options
        .jobs()
        .find(
          (job): job is Extract<DraftJob, { state: 'failed' }> =>
            job.state === 'failed'
        );
      if (failed) fail(failed, failed.message);
    })
  );

  createEffect(
    on(
      () => banner()?.id,
      (id) => {
        if (id) options.onScreen.markSeen(id);
      }
    )
  );

  onCleanup(
    options.onScreen.show(() => {
      const id = banner()?.id;
      return id ? [...watched(), id] : watched();
    })
  );
  let closed = false;
  onCleanup(() => {
    closed = true;
  });

  const view = (): DraftJobDialogView => {
    const job = opening() ?? drafting();
    if (job) return { kind: 'drafting', job };
    return { kind: 'describe', ready: banner(), restored: restored() };
  };

  return {
    view,
    /** Start a draft; answers why it didn't start, shown under the box. */
    async describe(description: string): Promise<string | undefined> {
      const job = await options.start(description);
      if (typeof job === 'string') return job;
      // Closed meanwhile: one under way is listed already; one finished isn't.
      if (closed) {
        if (job.state !== 'drafting') options.report(job);
        return undefined;
      }
      return match(job)
        .with({ state: 'drafting' }, () => {
          setRestored(undefined);
          return undefined;
        })
        .with({ state: 'failed' }, (failed) => {
          options.discard(failed.id);
          return failed.message;
        })
        .with({ state: 'ready' }, (finished) =>
          options.open(finished, 'dialog')
        )
        .exhaustive(() => undefined);
    },
    /** Stop the draft on screen; its request goes back in the box. */
    cancel() {
      const job = drafting();
      if (!job || opening()) return;
      setRestored({ description: job.request.description });
      options.discard(job.id);
    },
    review() {
      const job = banner();
      if (job) openReady(job, 'banner');
    },
    discardReady() {
      const job = banner();
      if (job) options.discard(job.id);
    },
  };
}
