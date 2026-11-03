import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { ComposerSurface, cn, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';
import { SOUP_ROW_CLASS } from './row-geometry';
import { useListLayout } from './shared';

/** Shared disclosure chrome; the host owns grouping, grid roles and navigation. */
export function ListGroupHeader(props: {
  label: string;
  count?: JSX.Element;
  icon?: JSX.Element;
  expanded: boolean;
  focused?: boolean;
  class?: string;
  controls?: string;
  /** Roving grid hosts opt out of the native tab stop. */
  tabIndex?: number;
  onToggle(): void;
  onFocus?(): void;
  onKeyDown?: JSX.EventHandler<HTMLButtonElement, KeyboardEvent>;
}) {
  const isWide = useListLayout()?.isWide ?? (() => true);
  const alignWithRows = () => isWide() && !isMobile();

  return (
    <Layer depth={3}>
      <ComposerSurface
        as="div"
        data-highlighted={props.focused || undefined}
        class={cn(
          isWide() ? SOUP_ROW_CLASS.wide : SOUP_ROW_CLASS.narrow,
          'group/header relative mr-1 my-0.5 w-[calc(100%-0.5rem)] rounded-xl text-ink-muted hover:bg-active',
          !isMobile() && 'ml-(--soup-row-gutter)',
          // Paint the touch border without shifting the shared row geometry.
          isTouchDevice() &&
            'rounded-lg border-edge-muted bg-surface after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-inherit',
          props.class,
          props.focused && 'bg-active'
        )}
      >
        <button
          type="button"
          tabIndex={props.tabIndex}
          class={cn(
            'grid min-w-0 w-full items-center gap-x-2 whitespace-nowrap rounded-[inherit] py-2 text-left text-xs font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-muted touch:min-h-11',
            alignWithRows()
              ? 'grid-cols-[var(--soup-row-indicator-width)_minmax(0,1fr)] pl-(--soup-row-padding-l) pr-3'
              : 'grid-cols-[1rem_minmax(0,1fr)] px-2'
          )}
          aria-expanded={props.expanded}
          aria-controls={props.controls}
          onMouseMove={props.onFocus}
          onClick={props.onToggle}
          onKeyDown={props.onKeyDown}
        >
          <Layer depth={3}>
            <span class="flex aspect-square w-full items-center justify-center rounded-xs group-hover/header:bg-ink/5">
              <CaretRightIcon
                class={cn(
                  'size-4 transition-transform',
                  props.expanded && 'rotate-90'
                )}
              />
            </span>
          </Layer>
          <div class="flex min-w-0 items-center gap-2">
            {props.icon}
            <span class="truncate" title={props.label}>
              {props.label}
            </span>
            <Show when={props.count !== undefined}>
              <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
                {props.count}
              </span>
            </Show>
          </div>
        </button>
      </ComposerSurface>
    </Layer>
  );
}
