/**
 * Connector from the inner vertical rail to the reply input area.
 * Renders a short vertical rail segment + a curved diagonal connector,
 * matching the block-channel Message component's thread-append connector.
 *
 * Must be rendered inside a `position: relative` wrapper whose left edge
 * is at `icon-width/2` to the right of the inner rail.
 */
export function ThreadReplyInputConnector() {
  return (
    <>
      {/* Short vertical rail segment from wrapper top to connector start */}
      <div
        class="absolute border-l border-edge-muted/80"
        style={{
          left: 'calc((var(--user-icon-width) / 2) * -1)',
          height:
            'calc(50% - (var(--user-icon-width) / 2 + 1px) / 24 * 18 + 1px)',
        }}
      />
      {/* Curved connector from rail to vertical center of the input area */}
      <div
        class="absolute text-edge-muted -z-1"
        style={{
          left: 'calc((var(--user-icon-width) / 2) * -1)',
          bottom: '50%',
          width: 'calc(var(--user-icon-width) / 2 + 1px)',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 18"
          width="100%"
        >
          <path
            stroke="currentColor"
            vector-effect="non-scaling-stroke"
            d="M23 17 4 6.0303C2.5 5.1643.5 4 .5.5"
          />
        </svg>
      </div>
    </>
  );
}
