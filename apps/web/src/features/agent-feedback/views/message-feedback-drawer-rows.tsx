/**
 * Rating rows in a message's touch action sheet, for an agent's message
 * within a feedback scope. Each row closes the sheet; the note opens from the
 * scope after it.
 */
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { fireAndForget } from '@core/util/fireAndForget';
import ThumbsDownFillIcon from '@icon/system/fill/thumbs-down-fill.svg';
import ThumbsUpFillIcon from '@icon/system/fill/thumbs-up-fill.svg';
import NoteIcon from '@icon/system/regular/pencil-simple.svg';
import ThumbsDownIcon from '@icon/system/regular/thumbs-down.svg';
import ThumbsUpIcon from '@icon/system/regular/thumbs-up.svg';
import { Show } from 'solid-js';
import { useResponseFeedback } from '../context/response-feedback-context';
import type { FeedbackRating } from '../core/subject';

export function MessageFeedbackDrawerRows(props: { onDone: () => void }) {
  const feedback = useResponseFeedback();

  return (
    <Show when={feedback()?.ready() && feedback()}>
      {(controller) => {
        const rate = (rating: FeedbackRating) => {
          fireAndForget(controller().rate(rating), 'agent-feedback');
          props.onDone();
        };
        return (
          <MobileDrawer.Section class="flex flex-col shrink-0 mb-3">
            <MobileDrawer.Item
              aria-pressed={controller().rating() === 'up'}
              disabled={controller().pending()}
              data-message-action="feedback-up"
              onClick={() => rate('up')}
            >
              <span class="size-5 flex items-center justify-center shrink-0">
                <Show
                  when={controller().rating() === 'up'}
                  fallback={<ThumbsUpIcon class="size-5" />}
                >
                  <ThumbsUpFillIcon class="size-5" />
                </Show>
              </span>
              {controller().rating() === 'up'
                ? t('agentFeedback.removeGood')
                : t('agentFeedback.good')}
            </MobileDrawer.Item>
            <MobileDrawer.Item
              aria-pressed={controller().rating() === 'down'}
              disabled={controller().pending()}
              data-message-action="feedback-down"
              onClick={() => rate('down')}
            >
              <span class="size-5 flex items-center justify-center shrink-0">
                <Show
                  when={controller().rating() === 'down'}
                  fallback={<ThumbsDownIcon class="size-5" />}
                >
                  <ThumbsDownFillIcon class="size-5" />
                </Show>
              </span>
              {controller().rating() === 'down'
                ? t('agentFeedback.removeBad')
                : t('agentFeedback.bad')}
            </MobileDrawer.Item>
            <Show when={controller().rating()}>
              <MobileDrawer.Item
                data-message-action="feedback-note"
                onClick={() => {
                  controller().openNote();
                  props.onDone();
                }}
              >
                <span class="size-5 flex items-center justify-center shrink-0">
                  <NoteIcon class="size-5" />
                </span>
                {controller().note() === null
                  ? t('agentFeedback.addNote')
                  : t('agentFeedback.editNote')}
              </MobileDrawer.Item>
            </Show>
          </MobileDrawer.Section>
        );
      }}
    </Show>
  );
}
