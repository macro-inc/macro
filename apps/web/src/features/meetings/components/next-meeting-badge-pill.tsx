import { cn } from '@ui';

/**
 * The accent pill under the sidebar's Calendar glyph (`Now`, `23m`). Positioned
 * against the nearest `relative` ancestor; `class` overrides the ring so it
 * matches whatever surface sits behind the glyph.
 */
export function NextMeetingBadgePill(props: { label: string; class?: string }) {
  return (
    <span
      aria-hidden="true"
      data-sidebar-badge
      class={cn(
        'pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-accent px-1 text-[9px] font-semibold leading-3 text-surface ring-2 ring-panel',
        props.class
      )}
    >
      {props.label}
    </span>
  );
}
