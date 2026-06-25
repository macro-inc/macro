import { isMobile } from '@core/mobile/isMobile';
import { cn, Layer } from '@ui';
import { type ParentProps, Show } from 'solid-js';

/**
 * Marks an island boundary inside a SplitHeader contribution. Every header
 * slot contribution must wrap its content in one of these (directly or via
 * SplitLabel / ResponsiveBlockToolbar) — there is no fallback styling for
 * bare slot content on mobile.
 *
 * Desktop: renders children directly — zero layout impact, so header content
 * needs no mobile fork. Mobile: renders a floating pill wrapped in the same
 * Layer depth as the rest of the floating chrome (dock, accessories), so
 * `island` surface colors match across the chrome.
 *
 * Note: crossing the mobile breakpoint remounts children.
 */
export function HeaderIsland(props: ParentProps<{ class?: string }>) {
  return (
    <Show when={isMobile()} fallback={props.children}>
      <Layer depth={3}>
        <div
          data-header-island
          class={cn(
            'island pointer-events-auto flex h-10 min-w-0 shrink-0 items-center gap-1 rounded-full px-3 empty:hidden',
            props.class
          )}
        >
          {props.children}
        </div>
      </Layer>
    </Show>
  );
}
