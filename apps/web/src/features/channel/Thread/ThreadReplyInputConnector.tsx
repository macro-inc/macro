/**
 * Connector from either the reply's inner rail or the parent thread spine to
 * the reply input area. Border-drawn so it shares the straight rail segments'
 * width.
 *
 * Render inside the composer wrapper; `rail` determines the source column.
 */
export function ThreadReplyInputConnector(props: {
  /** Channel-like threads keep the composer attached to the parent spine. */
  rail?: 'inner' | 'thread';
}) {
  const isThreadRail = () => props.rail === 'thread';

  return (
    <div
      class="pointer-events-none absolute top-0 -z-1 channel-rail-left channel-rail-bottom border-thread-rail rounded-bl-[14px]"
      style={{
        left: isThreadRail()
          ? 'calc(var(--user-icon-width) / 2 - var(--thread-shift) - var(--channel-rail-width) / 2)'
          : 'calc((var(--user-icon-width) / 2) * -1)',
        width: isThreadRail()
          ? 'calc(var(--thread-shift) - var(--user-icon-width) / 2 - var(--channel-rail-clearance))'
          : 'calc(var(--user-icon-width) / 2 + var(--channel-rail-width))',
        bottom: '50%',
      }}
    />
  );
}
