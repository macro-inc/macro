import { t } from '@app/lib/i18n';
import { CHANNEL_MENTION_EDGE_LIMIT } from '@queries/channel/mention-edge';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/** The rail's solid count: unread channels on a heading, mentions on a row. */
export function ChannelCountPill(props: {
  count: number;
  label?: string;
  class?: string;
  children?: JSX.Element;
}) {
  return (
    <Show when={props.count > 0}>
      <span
        role={props.label ? 'img' : undefined}
        aria-label={props.label}
        class={cn(
          'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none tabular-nums text-accent-contrast',
          props.class
        )}
      >
        {props.children ?? props.count}
      </span>
    </Show>
  );
}

/**
 * How many unread messages mention the viewer. A full edge means at least
 * `CHANNEL_MENTION_EDGE_LIMIT`, so it reads one less with `+`.
 */
export function ChannelMentionCount(props: { count: number; class?: string }) {
  const shownLimit = CHANNEL_MENTION_EDGE_LIMIT - 1;
  const capped = () => props.count >= CHANNEL_MENTION_EDGE_LIMIT;
  return (
    <ChannelCountPill
      count={props.count}
      class={props.class}
      label={
        capped()
          ? t('channelSections.manyUnreadMentions', { count: shownLimit })
          : t('channelSections.unreadMentions', { count: props.count })
      }
    >
      {capped() ? `${shownLimit}+` : props.count}
    </ChannelCountPill>
  );
}
