import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

type ThreadReplyMonorailProps = {
  /** Grouped replies have no avatar; the rail runs straight through them. */
  grouped?: boolean;
  /** The last reply with an avatar: the rail ends above that avatar. */
  terminal?: boolean;
};

function RailSegment(props: { class: string; style?: JSX.CSSProperties }) {
  return (
    <div
      class={cn(
        'pointer-events-none absolute -z-1 channel-rail-left border-thread-rail left-(--left-of-channel-rail)',
        props.class
      )}
      style={props.style}
    />
  );
}

/**
 * The rail for one reply row of an unindented thread. Replies sit in the
 * root's avatar column, so a single straight rail joins the avatars, broken
 * by the shared clearance around each one.
 */
export function ThreadReplyMonorail(props: ThreadReplyMonorailProps) {
  return (
    <Show when={!props.grouped} fallback={<RailSegment class="inset-y-0" />}>
      <RailSegment
        class="top-0"
        style={{
          height:
            'calc(var(--regular-message-padding-t) - var(--channel-rail-clearance))',
        }}
      />
      <Show when={!props.terminal}>
        <RailSegment
          class="bottom-0"
          style={{
            top: 'calc(var(--regular-message-padding-t) + var(--user-icon-width) + var(--channel-rail-clearance))',
          }}
        />
      </Show>
    </Show>
  );
}
