import { t } from '@app/lib/i18n';
import type { CollabSyncProblem } from '@core/component/LexicalMarkdown/collaboration/syncHealth';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import { Button } from '@ui';
import { match } from 'ts-pattern';
import { EditorSystemMessage } from './EditorSystemMessage';

/**
 * Tells the viewer their edits aren't reaching the server, or that the
 * document is disconnected, with a way to try again. Sticks to the top of the
 * document while it scrolls so it stays in view as they keep writing.
 */
export function CollabSyncMessage(props: {
  problem: CollabSyncProblem;
  onRetry: () => void;
}) {
  const copy = () =>
    match(props.problem)
      .with('unsaved', () => ({
        title: t('markdownEditor.syncUnsavedTitle'),
        description: t('markdownEditor.syncUnsavedDescription'),
      }))
      .with('offline', () => ({
        title: t('markdownEditor.syncOfflineTitle'),
        description: t('markdownEditor.syncOfflineDescription'),
      }))
      .exhaustive();

  return (
    <EditorSystemMessage
      variant={props.problem === 'unsaved' ? 'error' : 'warning'}
      data-sync-problem={props.problem}
      class="pointer-events-auto sticky top-[calc(var(--mobile-content-inset-top,0px)+0.5rem)] z-2 mb-2"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p class="min-w-0 flex-1 basis-60">
          <span class="font-medium">{copy().title}.</span> {copy().description}
        </p>
        <Button variant="secondary" size="sm" onClick={() => props.onRetry()}>
          <ArrowCounterClockwiseIcon class="size-4" />
          {t('common.retry')}
        </Button>
      </div>
    </EditorSystemMessage>
  );
}
