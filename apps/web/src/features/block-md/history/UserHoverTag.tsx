// A small floating tag: a user's accent dot + a label. Shared by the timeline
// scrubber (hovering a session lane) and the diff overlay (hovering changed text),
// so both surfaces show identical "who" affordances. Positioned absolutely within
// the caller's relatively-positioned container.
export function UserHoverTag(props: {
  label: string;
  color: string;
  left: number;
  top: number;
}) {
  return (
    <div
      class="pointer-events-none absolute z-30 flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-ink text-xs shadow-lg ring ring-edge-muted"
      style={{ left: `${props.left}px`, top: `${props.top}px` }}
    >
      <span
        class="size-2 shrink-0 rounded-full"
        style={{ background: props.color }}
      />
      <span class="max-w-40 truncate">{props.label}</span>
    </div>
  );
}
