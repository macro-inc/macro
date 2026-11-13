import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn, Tooltip } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';

export type ListColumnHeaderProps = {
  label: string;
  area: string;
  align?: 'start' | 'end';
  class?: string;
  narrowIcon?: JSX.Element;
  onWidthChange?: (width: number) => void;
  onClick?: () => void;
  active?: boolean;
  reversed?: boolean;
};

/** A shared grid header keeps its label discoverable when columns become icons. */
export function ListColumnHeader(props: ListColumnHeaderProps) {
  const alignment = () =>
    props.align === 'end' ? 'justify-end' : 'justify-start';
  const label = () => (
    <>
      <span class={props.narrowIcon ? '@max-[840px]/u-list:hidden' : undefined}>
        {props.label}
      </span>
      <Show when={props.narrowIcon}>
        <span class="hidden @max-[840px]/u-list:inline-flex">
          <Tooltip
            label={props.label}
            as="span"
            tabIndex={props.onClick ? undefined : 0}
          >
            {props.narrowIcon}
          </Tooltip>
        </span>
      </Show>
    </>
  );
  return (
    <div
      role="columnheader"
      aria-label={props.label}
      class={cn(
        'ms-2 flex min-w-0 items-center',
        alignment(),
        props.narrowIcon &&
          props.align !== 'end' &&
          '@max-[840px]/u-list:justify-center',
        props.class
      )}
      style={{ 'grid-area': props.area }}
    >
      <Switch>
        <Match when={props.onClick}>
          {(onClick) => (
            <button
              ref={(element) => {
                if (props.onWidthChange)
                  createResizeObserver(element, ({ width }) =>
                    props.onWidthChange?.(width)
                  );
              }}
              type="button"
              aria-label={props.label}
              data-blocks-navigation
              class={cn(
                'flex h-full w-max shrink-0 items-center gap-1 whitespace-nowrap text-ink-extra-muted hover:text-ink',
                props.active && 'text-ink'
              )}
              onClick={onClick()}
            >
              {label()}
              <ArrowDownIcon
                class={cn(
                  'size-3 shrink-0 transition-transform',
                  props.reversed && 'rotate-180'
                )}
              />
            </button>
          )}
        </Match>
        <Match when={true}>
          <span class="truncate">{label()}</span>
        </Match>
      </Switch>
    </div>
  );
}
