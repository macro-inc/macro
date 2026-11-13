import { type JSX, Show } from 'solid-js';
import { RoutineDescribe } from './components/routine-describe';
import { RoutineDraftProgress } from './components/routine-draft-progress';
import { RoutineDraftReady } from './components/routine-draft-ready';
import { useDraftsOnScreen } from './context/drafts-on-screen';
import { draftMilestones } from './core/draft-progress';
import { openDraftJob } from './open-draft-job';
import {
  createDraftJobDialog,
  type RestoredRequest,
} from './primitives/draft-job-dialog';
import {
  discardDraftJob,
  draftJobName,
  startDraftJob,
  useDraftJobs,
} from './queries/draft-jobs';
import { useComposerContext } from './routine-ai-composer';

/** What New routine shows for a background draft. */
export type BackgroundDraftSlots = {
  /** A draft under way, in place of the describe box; nothing otherwise. */
  drafting: JSX.Element;
  /** The describe box, with a finished draft waiting above it. */
  describe(): JSX.Element;
};

// The describe box is mounted once per request put back in it.
const NOTHING_RESTORED: RestoredRequest = { description: '' };

/**
 * Production composition for New routine's background drafts
 * (`enable-routine-background-drafts`): the draft carries on when the dialog
 * closes, and the app's pill and toasts report it from then on.
 */
export function RoutineBackgroundDrafts(props: {
  defaultModel: string;
  decisionsEnabled: boolean;
  /** Shows the new routine's page once its first draft is stored. */
  open(): void;
  children(slots: BackgroundDraftSlots): JSX.Element;
}) {
  const drafts = useDraftJobs(() => true);
  const context = useComposerContext({
    defaultModel: () => props.defaultModel,
    decisionsEnabled: () => props.decisionsEnabled,
  });
  const dialog = createDraftJobDialog({
    jobs: drafts.jobs,
    loaded: drafts.loaded,
    onScreen: useDraftsOnScreen(),
    start: (description) => startDraftJob(description, context()),
    open: (job, from) =>
      openDraftJob(job, {
        defaultModel: props.defaultModel,
        from,
        open: () => props.open(),
      }),
    discard: discardDraftJob,
  });
  const drafting = () => {
    const view = dialog.view();
    return view.kind === 'drafting' ? view.job : undefined;
  };
  const describing = () => {
    const view = dialog.view();
    return view.kind === 'describe' ? view : undefined;
  };
  return props.children({
    get drafting() {
      return (
        <Show when={drafting()}>
          {(job) => (
            <RoutineDraftProgress
              request={job().request.description}
              milestones={draftMilestones(job().progress)}
              onCancel={dialog.cancel}
            />
          )}
        </Show>
      );
    },
    describe: () => (
      <>
        <Show when={describing()?.ready}>
          {(job) => (
            <RoutineDraftReady
              name={draftJobName(job())}
              request={job().request.description}
              onReview={dialog.review}
              onDiscard={dialog.discardReady}
            />
          )}
        </Show>
        <Show when={describing()?.restored ?? NOTHING_RESTORED} keyed>
          {(restored) => (
            <RoutineDescribe
              onDescribe={dialog.describe}
              initialValue={restored.description}
              initialError={restored.error}
            />
          )}
        </Show>
      </>
    ),
  });
}
