import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ZoomDetail } from '../core/camera';
import type { BoardPerson } from '../core/people';
import { AgeLabel } from './age-label';
import { UnreadBadge } from './conversation-card';
import { kindGlyph } from './glyphs';
import type { AvatarComponent } from './message-stack';
import { SpeechBubble } from './speech-bubble';

/**
 * V1E's card: one person and what they said lately, wherever they said it.
 * Each line names its conversation and opens it.
 */
export function PersonCard(props: {
  person: BoardPerson;
  now: number;
  detail: ZoomDetail;
  role: string;
  Avatar: AvatarComponent;
  onOpenLine: (itemKey: string) => void;
}) {
  // Oldest first, so the card reads top to bottom like a conversation.
  const lines = () => [...props.person.lines].reverse();
  return (
    <article class="relative flex flex-col gap-3 rounded-2xl border border-edge-muted bg-panel p-3 shadow-sm transition-shadow group-hover/node:shadow-md">
      <div
        class={cn(
          'flex min-w-0 flex-col gap-3',
          props.detail === 'far' && 'invisible'
        )}
      >
        <header class="flex min-w-0 items-center gap-2.5">
          <props.Avatar author={props.person.author} size={36} />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm leading-5 font-semibold text-ink">
              {props.person.author.name}
            </span>
            <span class="truncate text-xs leading-4 text-ink-muted">
              {props.role}
            </span>
          </div>
          <AgeLabel
            at={props.person.lastActivityAt}
            now={props.now}
            class="self-start pt-0.5 text-xs text-ink-extra-muted"
          />
          <Show when={props.person.unreadCount > 0}>
            <UnreadBadge count={props.person.unreadCount} class="self-start" />
          </Show>
        </header>
        <ol class="flex min-w-0 flex-col gap-2">
          {/* Keyed by message: the person is rebuilt on every clock tick and
              read, and a remounted line would drop focus. */}
          <Key
            each={lines()}
            by={(line) => `${line.itemKey}:${line.message.id}`}
          >
            {(line, index) => (
              <li class="min-w-0">
                <button
                  type="button"
                  class="group/line flex w-full min-w-0 flex-col items-start gap-1 rounded-xl text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => props.onOpenLine(line().itemKey)}
                >
                  <span class="flex max-w-full min-w-0 items-center gap-1 px-1 text-[11px] text-ink-muted group-hover/line:text-ink">
                    <Dynamic
                      component={kindGlyph(line().itemKind)}
                      class="size-3 shrink-0"
                    />
                    <span class="truncate">{line().itemTitle}</span>
                    <span aria-hidden="true">·</span>
                    <AgeLabel
                      at={line().message.at}
                      now={props.now}
                      class="text-ink-extra-muted"
                    />
                  </span>
                  <SpeechBubble
                    text={line().message.text}
                    tone="incoming"
                    tail={index() === lines().length - 1}
                    lines={2}
                    unread={line().message.unread}
                    class="transition-[filter] group-hover/line:brightness-110"
                  />
                </button>
              </li>
            )}
          </Key>
        </ol>
      </div>
      <Show when={props.detail === 'far'}>
        <div class="absolute inset-0 flex items-center gap-4 p-5">
          <props.Avatar author={props.person.author} size={72} />
          <span class="line-clamp-2 text-[30px] leading-9 font-semibold tracking-tight text-ink">
            {props.person.author.name}
          </span>
        </div>
      </Show>
    </article>
  );
}
