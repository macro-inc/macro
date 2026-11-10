import { t } from '@app/lib/i18n';
import type { CallDiscussionSource } from '@channel/Call/chat/CallChatHistory';
import { Message } from '@channel/Message';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { formatVideoTimestamp } from '@core/util/duration';
import { fireAndForget } from '@core/util/fireAndForget';
import PlayIcon from '@icon/system/regular/play.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { messageVideoSeconds } from '../../core/recording-chat';
import { createRecordingChat } from '../../primitives/recording-chat';

export function CallRecordingChat(props: {
  source: CallDiscussionSource;
  timelineStartMs: number | null;
  durationSeconds?: number;
  onSeek?: (seconds: number) => void;
  targetId?: string;
  requestKey?: string | number;
  onClearTarget?: () => void;
  hideHeading?: boolean;
}) {
  const { messages, registerRow } = createRecordingChat(props);
  return (
    <section
      class="flex min-w-0 flex-col gap-5"
      aria-label={t('calls.detailCallChat')}
    >
      <Show when={!props.hideHeading}>
        <h3 class="flex items-center gap-2 text-base font-semibold">
          Call chat{' '}
          <span class="font-normal text-ink-muted">{messages().length}</span>
        </h3>
      </Show>
      <Show when={props.source.loading()}>
        <p class="text-sm text-ink-muted">{t('calls.detailLoadingChat')}</p>
      </Show>
      <Show
        when={
          !props.source.loading() &&
          !props.source.failed() &&
          messages().length === 0
        }
      >
        <p class="text-sm text-ink-muted">{t('calls.detailEmptyChat')}</p>
      </Show>
      <Show when={props.source.failed()}>
        <p role="alert" class="text-sm text-ink-muted">
          {t('calls.detailFailedChat')}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            fireAndForget(props.source.refresh(), 'call-recording-chat')
          }
        >
          {t('calls.detailRetry')}
        </Button>
      </Show>
      <StaticMarkdownContext>
        <div class="flex min-w-0 flex-col gap-6">
          <For each={messages()}>
            {(message) => {
              const seconds = () =>
                messageVideoSeconds(
                  message.created_at,
                  props.timelineStartMs,
                  props.durationSeconds
                );
              return (
                <Message.Root
                  message={message}
                  ref={(el) => registerRow(message.id, el)}
                  targeted={props.targetId === message.id}
                  onClick={() =>
                    props.targetId === message.id && props.onClearTarget?.()
                  }
                >
                  <div class="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-1">
                    <div class="row-span-3">
                      <Message.SenderIcon />
                    </div>
                    <div class="flex min-w-0 items-center gap-2 text-sm">
                      <Message.SenderName />
                      <Message.Timestamp />
                      <Show when={seconds() !== null && props.onSeek}>
                        <Button
                          variant="secondary"
                          size="xs"
                          class="ml-auto shrink-0"
                          onClick={() => props.onSeek?.(seconds()!)}
                          aria-label={t('calls.detailPlayAt', {
                            time: formatVideoTimestamp(seconds() ?? 0),
                          })}
                        >
                          <PlayIcon class="size-3" />
                          {formatVideoTimestamp(seconds() ?? 0)}
                        </Button>
                      </Show>
                    </div>
                    <Message.Content />
                    <Message.Attachments />
                  </div>
                </Message.Root>
              );
            }}
          </For>
        </div>
      </StaticMarkdownContext>
    </section>
  );
}
