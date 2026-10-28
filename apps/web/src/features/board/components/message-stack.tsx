import { cn } from '@ui';
import { type Component, For, Match, Show, Switch } from 'solid-js';
import type { BoardAuthor, BoardMessage } from '../core/item';
import { bubbleTone, SpeechBubble } from './speech-bubble';

export type AvatarComponent = Component<{ author: BoardAuthor; size: number }>;

const sameAuthor = (a?: BoardMessage, b?: BoardMessage) =>
  a?.author?.id !== undefined && a.author.id === b?.author?.id;

/**
 * Messages as a phone conversation: consecutive messages from one person
 * form a run with the face and tail on its last bubble, the viewer's own
 * messages sit on the right, and system events read as quiet captions.
 */
export function MessageStack(props: {
  messages: readonly BoardMessage[];
  /** Name each run in group conversations; a direct message needs no names. */
  showNames: boolean;
  Avatar: AvatarComponent;
  size?: 'sm' | 'md';
  lines?: 1 | 2 | 3;
  class?: string;
}) {
  const avatarSize = () => (props.size === 'sm' ? 18 : 22);
  return (
    <ol class={cn('flex min-w-0 flex-col gap-0.5', props.class)}>
      <For each={props.messages}>
        {(message, index) => {
          const previous = () => props.messages[index() - 1];
          const next = () => props.messages[index() + 1];
          const startsRun = () => !sameAuthor(previous(), message);
          const endsRun = () => !sameAuthor(message, next());
          const tone = () => bubbleTone(message);
          return (
            <li
              class={cn(
                'flex min-w-0 items-end gap-1.5',
                startsRun() && index() > 0 && 'mt-1.5',
                tone() === 'outgoing' && 'justify-end pl-8',
                tone() === 'incoming' && 'pr-6',
                tone() === 'system' && 'justify-center'
              )}
            >
              <Switch>
                <Match when={tone() === 'system'}>
                  <span class="truncate text-[11px] text-ink-extra-muted">
                    {message.text}
                  </span>
                </Match>
                <Match when={tone() === 'incoming' && message.author}>
                  {(author) => (
                    <>
                      <span
                        class="shrink-0"
                        style={{
                          width: `${avatarSize()}px`,
                          height: `${avatarSize()}px`,
                        }}
                      >
                        <Show when={endsRun()}>
                          <props.Avatar author={author()} size={avatarSize()} />
                        </Show>
                      </span>
                      <div class="flex min-w-0 flex-col items-start gap-0.5">
                        <Show when={props.showNames && startsRun()}>
                          <span class="max-w-full truncate px-2.5 text-[11px] leading-3.5 text-ink-muted">
                            {author().name}
                          </span>
                        </Show>
                        <SpeechBubble
                          text={message.text}
                          tone="incoming"
                          tail={endsRun()}
                          size={props.size}
                          lines={props.lines}
                          unread={message.unread}
                        />
                      </div>
                    </>
                  )}
                </Match>
                <Match when={tone() === 'outgoing'}>
                  <SpeechBubble
                    text={message.text}
                    tone="outgoing"
                    tail={endsRun()}
                    size={props.size}
                    lines={props.lines}
                  />
                </Match>
              </Switch>
            </li>
          );
        }}
      </For>
    </ol>
  );
}
