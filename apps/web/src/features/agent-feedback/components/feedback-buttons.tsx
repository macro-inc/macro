/**
 * Thumbs up and down for one agent response, and, once rated, a note button.
 * The pressed thumb is filled; pressing it again removes the rating.
 */
import { t } from '@app/lib/i18n';
import ThumbsDownFillIcon from '@icon/system/fill/thumbs-down-fill.svg';
import ThumbsUpFillIcon from '@icon/system/fill/thumbs-up-fill.svg';
import NoteIcon from '@icon/system/regular/pencil-simple.svg';
import ThumbsDownIcon from '@icon/system/regular/thumbs-down.svg';
import ThumbsUpIcon from '@icon/system/regular/thumbs-up.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import type { FeedbackRating } from '../core/subject';

export function FeedbackButtons(props: {
  rating: FeedbackRating | undefined;
  hasNote: boolean;
  pending: boolean;
  onRate: (rating: FeedbackRating) => void;
  onNote: () => void;
  class?: string;
}) {
  const upLabel = () =>
    props.rating === 'up'
      ? t('agentFeedback.removeGood')
      : t('agentFeedback.good');
  const downLabel = () =>
    props.rating === 'down'
      ? t('agentFeedback.removeBad')
      : t('agentFeedback.bad');
  const noteLabel = () =>
    props.hasNote ? t('agentFeedback.editNote') : t('agentFeedback.addNote');

  return (
    <div
      class={cn('flex items-center gap-0.5', props.class)}
      data-testid="agent-feedback-buttons"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={upLabel()}
        aria-pressed={props.rating === 'up'}
        tooltip={upLabel()}
        disabled={props.pending}
        onClick={() => props.onRate('up')}
      >
        <Show
          when={props.rating === 'up'}
          fallback={<ThumbsUpIcon class="size-4" />}
        >
          <ThumbsUpFillIcon class="size-4" />
        </Show>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={downLabel()}
        aria-pressed={props.rating === 'down'}
        tooltip={downLabel()}
        disabled={props.pending}
        onClick={() => props.onRate('down')}
      >
        <Show
          when={props.rating === 'down'}
          fallback={<ThumbsDownIcon class="size-4" />}
        >
          <ThumbsDownFillIcon class="size-4" />
        </Show>
      </Button>
      <Show when={props.rating}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={noteLabel()}
          tooltip={noteLabel()}
          onClick={() => props.onNote()}
        >
          <NoteIcon class="size-4" />
        </Button>
      </Show>
    </div>
  );
}
