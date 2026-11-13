import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import {
  type BackgroundWorkSummary,
  showBackgroundWork,
} from '@core/component/BackgroundWork/backgroundWork';
import { type CustomToastConfig, toast } from '@core/component/Toast/Toast';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import CheckIcon from '@icon/system/regular/check.svg';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg';
import type { DraftJob } from '@service-scheduled-action/generated/schemas';
import { onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import { useDraftsOnScreen } from './context/drafts-on-screen';
import { type DraftActivity, draftActivity } from './core/draft-progress';
import { openDraftJob } from './open-draft-job';
import {
  discardDraftJob,
  draftJobName,
  type ReadyDraftJob,
  useDraftJobs,
} from './queries/draft-jobs';

// Closing a ready draft's toast keeps it for New routine; it stays closed.
const CLOSED_TOASTS_KEY = 'macro:routine-draft-toasts:closed';

function activityLabel(activity: DraftActivity): string {
  return match(activity)
    .with('finding', () => t('routineDrafts.findingNames'))
    .with('writing', () => t('routineDrafts.writingSteps'))
    .with('checking', () => t('routineDrafts.checkingRuns'))
    .with('fixing', () => t('routineDrafts.fixingProblems'))
    .with('finishing', () => t('routineDrafts.finishingUp'))
    .exhaustive();
}

function SuccessIcon(props: { class?: string }) {
  return <CheckIcon class={`${props.class ?? ''} text-success`} />;
}

function FailureIcon(props: { class?: string }) {
  return <ExclamationIcon class={`${props.class ?? ''} text-failure`} />;
}

/**
 * Reports background routine drafts New routine isn't showing: a pill while
 * they draft, and a toast once one is ready or failed. Mount once, inside the
 * authenticated app, under `DraftsOnScreenContext`.
 */
export function RoutineDraftsWatcher() {
  const drafts = useDraftJobs(() => true);
  const onScreen = useDraftsOnScreen();
  const layout = useSplitLayout();
  const hasPaidAccess = useHasPaidAccess();
  const offScreen = (job: DraftJob) => !onScreen.isShown(job.id);
  const openCreator = () =>
    layout.popoverSplit({ type: 'component', id: 'routine-compose' });

  const pill = (): BackgroundWorkSummary | undefined => {
    const drafting = drafts
      .jobs()
      .filter((job) => job.state === 'drafting' && offScreen(job));
    const [only] = drafting;
    if (!only) return undefined;
    if (drafting.length > 1) {
      return {
        label: t('routineDrafts.draftingMany', { count: drafting.length }),
        onOpen: openCreator,
      };
    }
    return {
      label: t('routineDrafts.drafting'),
      detail: activityLabel(draftActivity(only.progress)),
      onOpen: openCreator,
    };
  };
  onCleanup(showBackgroundWork(pill));

  const review = (job: ReadyDraftJob) => {
    const error = openDraftJob(job, {
      defaultModel: defaultModelForPlan(hasPaidAccess()),
      from: 'toast',
      open: () => openAgentsPage(layout, 'routines', { routineId: 'new' }),
    });
    if (error) toast.failure(t('routineDrafts.openFailed'));
  };

  const finishedToast = (
    job: DraftJob,
    dismiss: () => void
  ): CustomToastConfig =>
    match(job)
      .with({ state: 'ready' }, (ready) => ({
        title: t('routineDrafts.readyTitle'),
        icon: SuccessIcon,
        content: () => <span>{draftJobName(ready)}</span>,
        actions: [
          {
            label: t('routineDrafts.review'),
            variant: 'primary' as const,
            onClick: () => {
              dismiss();
              review(ready);
            },
          },
        ],
      }))
      .with({ state: 'failed' }, (failed) => ({
        title: t('routineDrafts.failedTitle'),
        titleColor: 'var(--color-failure)',
        icon: FailureIcon,
        content: () => <span>{failed.message}</span>,
        actions: [
          {
            label: t('routineDrafts.editRequest'),
            variant: 'primary' as const,
            // New routine puts the request back in its box, with why.
            onClick: () => {
              dismiss();
              openCreator();
            },
          },
        ],
      }))
      // Only finished drafts get a toast.
      .with({ state: 'drafting' }, () => ({
        title: t('routineDrafts.drafting'),
      }))
      .exhaustive(() => ({ title: t('routineDrafts.drafting') }));

  useKeyedPersistentToasts({
    items: () =>
      drafts
        .jobs()
        .filter(
          (job) =>
            job.state !== 'drafting' &&
            offScreen(job) &&
            !onScreen.wasSeen(job.id)
        ),
    key: (job) => job.id,
    toast: finishedToast,
    persistKey: CLOSED_TOASTS_KEY,
    itemsLoaded: drafts.loaded,
    dismissStyle: (job) => (job.state === 'ready' ? 'icon' : undefined),
    // A failure closed is done with; a ready draft waits in New routine.
    onUserDismiss: (job) => {
      if (job.state === 'failed') discardDraftJob(job.id);
    },
  });

  return null;
}
