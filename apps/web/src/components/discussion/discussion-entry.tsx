import { formatLocale, t } from '@app/lib/i18n';
import { MessageProvider } from '@channel/Message/context';
import { SenderIcon } from '@channel/Message/SenderIcon';
import { SenderName } from '@channel/Message/SenderName';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ChatCircleIcon from '@icon/system/regular/chat-circle.svg';
import { AvatarGroup } from '@ui';
import { For, Show } from 'solid-js';
import type { discussionPreview } from './discussion-preview';

export function DiscussionEntry(props: {
  preview: ReturnType<typeof discussionPreview>;
  onOpen(): void;
  triggerRef?: (element: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      ref={props.triggerRef}
      onClick={props.onOpen}
      aria-haspopup="dialog"
      class="block w-full rounded-3xl bg-ink/5 p-3 text-left"
    >
      <Show when={props.preview.newest}>
        {(message) => (
          <div class="flex gap-2 [--avatar-group-separator:var(--color-panel)]">
            <MessageProvider value={message}>
              <SenderIcon class="size-8" interactive={false} />
            </MessageProvider>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2 text-sm">
                <span class="truncate font-medium">
                  <SenderName message={message()} />
                </span>
                <time
                  class="shrink-0 text-xs text-ink-muted"
                  dateTime={message().created_at}
                >
                  {new Intl.DateTimeFormat(formatLocale(), {
                    month: 'short',
                    day: 'numeric',
                  }).format(new Date(message().created_at))}
                </time>
              </div>
              <div class="pointer-events-none mt-1 line-clamp-2 text-sm leading-relaxed">
                <StaticMarkdown
                  markdown={message().content}
                  theme={channelTheme}
                  target="internal"
                  inert
                />
              </div>
            </div>
          </div>
        )}
      </Show>
      <Show
        when={props.preview.hasComments}
        fallback={
          <span class="flex min-h-6 items-center gap-3 text-sm text-ink-muted">
            <ChatCircleIcon class="size-4" />
            {t('common.startDiscussion')}
            <CaretRightIcon class="ml-auto size-4" />
          </span>
        }
      >
        <div
          class="flex items-center gap-2 text-sm text-ink-muted [--avatar-group-separator:var(--color-panel)]"
          classList={{
            'mt-2 ml-10': !!props.preview.newest,
            'min-h-6': !props.preview.newest,
          }}
        >
          <Show when={props.preview.commenters.length > 0}>
            <AvatarGroup size="sm">
              <For each={props.preview.commenters.slice(0, 3)}>
                {(commenter) => (
                  <MessageProvider value={() => commenter}>
                    <SenderIcon class="size-4" interactive={false} />
                  </MessageProvider>
                )}
              </For>
              <Show when={props.preview.commenters.length > 3}>
                <AvatarGroup.Count size="sm">
                  +{props.preview.commenters.length - 3}
                </AvatarGroup.Count>
              </Show>
            </AvatarGroup>
          </Show>
          <span>{t('common.viewDiscussion')}</span>
          <CaretRightIcon class="size-4" />
        </div>
      </Show>
    </button>
  );
}
