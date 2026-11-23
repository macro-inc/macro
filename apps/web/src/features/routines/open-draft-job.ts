import { Telemetry } from '@macro-inc/observability';
import {
  discardDraftJob,
  draftFromJob,
  type ReadyDraftJob,
} from './queries/draft-jobs';
import { startRoutineDraft } from './routine-draft-start';

/** Where a finished draft was opened from. */
export type DraftOpenedFrom = 'dialog' | 'banner' | 'toast';

/**
 * Open a finished background draft on the new routine's page, where it is
 * reviewed before it's saved; `open` shows that page. The job is done with
 * once its draft is handed over. Answers why it couldn't open, if it
 * couldn't.
 */
export function openDraftJob(
  job: ReadyDraftJob,
  options: {
    defaultModel: string;
    from: DraftOpenedFrom;
    open(): void;
  }
): string | undefined {
  const span = Telemetry.span('routine.draft.open');
  span.setAttr('routine.draft.id', job.id);
  span.setAttr('routine.draft.opened_from', options.from);
  const draft = draftFromJob(job, options.defaultModel);
  // Its discard request joins this trace.
  span.run(() => discardDraftJob(job.id));
  if (typeof draft === 'string') {
    span.setAttr('routine.draft.outcome', 'unusable');
    span.error('Routine draft could not open');
    span.end();
    return draft;
  }
  span.setAttr('routine.draft.outcome', 'opened');
  startRoutineDraft(draft);
  options.open();
  span.end();
  return undefined;
}
