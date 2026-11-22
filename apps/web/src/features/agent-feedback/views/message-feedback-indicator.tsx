/**
 * A small filled thumb under an agent's message the person has rated, so the
 * rating shows without hovering. It opens the note, to add or edit it.
 */
import { t } from '@app/lib/i18n';
import ThumbsDownFillIcon from '@icon/system/fill/thumbs-down-fill.svg';
import ThumbsUpFillIcon from '@icon/system/fill/thumbs-up-fill.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useResponseFeedback } from '../context/response-feedback-context';

export function MessageFeedbackIndicator() {
  const feedback = useResponseFeedback();

  return (
    <Show when={feedback()?.rating() && feedback()}>
      {(controller) => {
        const label = () =>
          controller().rating() === 'up'
            ? t('agentFeedback.ratedGood')
            : t('agentFeedback.ratedBad');
        return (
          <div class="flex">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label()}
              tooltip={label()}
              data-testid="agent-feedback-indicator"
              onClick={(event) => {
                event.stopPropagation();
                controller().openNote();
              }}
            >
              <Show
                when={controller().rating() === 'up'}
                fallback={
                  <ThumbsDownFillIcon class="size-3.5 text-ink-muted" />
                }
              >
                <ThumbsUpFillIcon class="size-3.5 text-ink-muted" />
              </Show>
            </Button>
          </div>
        );
      }}
    </Show>
  );
}
