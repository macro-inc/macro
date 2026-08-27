export function ThreadRail() {
  return (
    <div
      class="pointer-events-none absolute top-0 bottom-0 channel-rail-left border-thread-rail -z-1"
      style={{
        left: 'var(--left-of-channel-rail)',
      }}
    />
  );
}
