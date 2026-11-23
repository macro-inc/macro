/**
 * Thumbs in a message's hover toolbar, for an agent's message within a
 * feedback scope. Renders its own trailing divider, so the toolbar needs no
 * knowledge of whether the message can be rated.
 */
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import ThumbsDownFillIcon from '@icon/system/fill/thumbs-down-fill.svg';
import ThumbsUpFillIcon from '@icon/system/fill/thumbs-up-fill.svg';
import ThumbsDownIcon from '@icon/system/regular/thumbs-down.svg';
import ThumbsUpIcon from '@icon/system/regular/thumbs-up.svg';
import { Toolbar } from '@ui';
import { Show } from 'solid-js';
import { useResponseFeedback } from '../context/response-feedback-context';

export function MessageFeedbackToolbar() {
  const feedback = useResponseFeedback();

  return (
    <Show when={feedback()?.ready() && feedback()}>
      {(controller) => {
        return (
          <>
            <Toolbar.Group>
              <Toolbar.Button
                aria-label={t('agentFeedback.good')}
                aria-pressed={controller().rating() === 'up'}
                tooltip={t('agentFeedback.good')}
                data-message-action="feedback-up"
                onClick={() =>
                  fireAndForget(controller().rate('up'), 'agent-feedback')
                }
              >
                <Show
                  when={controller().rating() === 'up'}
                  fallback={<ThumbsUpIcon class="size-4" />}
                >
                  <ThumbsUpFillIcon class="size-4" />
                </Show>
              </Toolbar.Button>
              <Toolbar.Button
                aria-label={t('agentFeedback.bad')}
                aria-pressed={controller().rating() === 'down'}
                tooltip={t('agentFeedback.bad')}
                data-message-action="feedback-down"
                onClick={() =>
                  fireAndForget(controller().rate('down'), 'agent-feedback')
                }
              >
                <Show
                  when={controller().rating() === 'down'}
                  fallback={<ThumbsDownIcon class="size-4" />}
                >
                  <ThumbsDownFillIcon class="size-4" />
                </Show>
              </Toolbar.Button>
            </Toolbar.Group>
            <Toolbar.Divider />
          </>
        );
      }}
    </Show>
  );
}
