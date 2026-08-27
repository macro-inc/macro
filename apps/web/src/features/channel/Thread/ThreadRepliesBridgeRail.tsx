/** Connects the root-message rail to the first reply across the reply padding. */
export function ThreadRepliesBridgeRail() {
  return (
    <div class="pointer-events-none absolute top-0 -z-1 channel-rail-left border-thread-rail left-(--left-of-channel-rail) h-(--thread-padding-y)" />
  );
}
