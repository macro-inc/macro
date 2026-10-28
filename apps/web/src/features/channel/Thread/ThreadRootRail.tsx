import { Show } from 'solid-js';

type ThreadRootRailProps = {
  grouped?: boolean;
  visible?: boolean;
};

/**
 * The parent-message segment of a channel-like thread, including the filled
 * fork node used when a grouped message becomes a thread root.
 */
export function ThreadRootRail(props: ThreadRootRailProps) {
  return (
    <Show when={props.visible}>
      <div
        class="pointer-events-none absolute channel-rail-left border-thread-rail -z-1 left-(--left-of-channel-rail) bottom-0"
        style={{
          top: props.grouped
            ? '0'
            : 'calc(var(--regular-message-padding-t) + var(--user-icon-width) + var(--channel-rail-clearance))',
        }}
      />
      <Show when={props.grouped}>
        <div
          class="pointer-events-none absolute top-2 size-1.5 rounded-full ring-1 ring-surface bg-thread-rail left-(--channel-rail-center) -translate-x-1/2"
          data-thread-fork-node
        />
      </Show>
    </Show>
  );
}
