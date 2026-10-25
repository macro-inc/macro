import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { SegmentedControl as KSegmentedControl } from '@kobalte/core/segmented-control';
import { type Component, For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Layer } from './Layer';
import { Tooltip } from './Tooltip';

export type TabOption<T extends string> = {
  value: T;
  /** Accessible name, and the tooltip when the group is icon-only. */
  label: string;
  icon?: Component<{ class?: string }>;
  /** Shown after the label in muted figures. */
  count?: number;
  disabled?: boolean;
};

/** Pill height matches the Button of the same size. */
export type TabsSize = 'sm' | 'md' | 'lg';

/**
 * Desktop always renders separate pills. Touch keeps the treatment each
 * surface already had: a sliding pill, a bordered inset track, divided
 * segments, or the same separate pills as desktop.
 */
export type TabsTouchStyle = 'pill' | 'inset' | 'segmented' | 'pills';

export type TabsProps<T extends string> = {
  'aria-label': string;
  options: readonly TabOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** Stretch to the container with equal-width options. */
  fullWidth?: boolean;
  /** Show only icons, with each label as a tooltip; options without an icon keep their label. */
  iconOnly?: boolean;
  disabled?: boolean;
  /** Placement only (margins, width, alignment); never restyle the options. */
  class?: string;
  ref?: (element: HTMLElement) => void;
} & (
  | {
      variant?: 'pills';
      size?: TabsSize;
      /** Let many options flow onto more lines; renders pills on touch too. */
      wrap?: boolean;
      touch?: TabsTouchStyle;
    }
  | {
      /**
       * One raised pill slides along a filled track, on every device. Only for
       * the agent composer's mode switch, which sits in the composer's tray.
       */
      variant: 'track';
      size?: never;
      wrap?: never;
      touch?: never;
    }
);

/**
 * One inline single choice: switch a view, a section, or a small set of
 * values. On desktop each option is its own pill, the outline Button frame,
 * and the selected option takes the pressed fill.
 *
 * @do Use for two to six short options that are all visible at once.
 * @do Put view tabs left of the header controls, after the title.
 * @do Use `iconOnly` to collapse a narrow header; keep `label` as the name.
 * @do Use `size` to match neighbouring controls: `md` beside 32px buttons.
 * @do Set `touch` to the look the surface had on touch: `pill` (sliding),
 *   `inset`, `segmented`, or `pills` for separate pills like desktop.
 * @dont Do not build tabs from Buttons, a ButtonGroup, or HeaderActionGroup.
 * @dont Do not put Tabs inside a HeaderActionGroup or ButtonGroup.
 * @dont Do not use Tabs for tabs that own panels or a dynamic collection; use TabSelector.
 * @dont Do not branch on `isTouchDevice()` to pick a tab component; set `touch`.
 * @dont Do not use `variant="track"` outside the agent composer's tray.
 */
export function Tabs<T extends string>(props: TabsProps<T>) {
  const select = (value: string) => {
    const option = props.options.find((option) => option.value === value);
    if (option) props.onChange(option.value);
  };
  // Desktop and wrapping rows always render separate pills.
  const touchStyle = (): TabsTouchStyle =>
    isTouchDevice() && !props.wrap ? (props.touch ?? 'pill') : 'pills';

  return (
    <KSegmentedControl
      ref={props.ref}
      aria-label={props['aria-label']}
      value={props.value ?? ''}
      onChange={select}
      disabled={props.disabled}
      class={cn(
        'relative inline-flex min-w-0 items-center',
        props.fullWidth && 'flex w-full',
        props.class
      )}
    >
      <Switch
        fallback={
          <div
            class={cn(
              'flex min-w-0 items-center',
              props.wrap && 'flex-wrap',
              props.size === 'sm' ? 'gap-1' : 'gap-1.5',
              props.fullWidth && 'w-full'
            )}
          >
            <For each={props.options}>
              {(option) => (
                <PillOption
                  option={option}
                  size={props.size ?? 'md'}
                  iconOnly={props.iconOnly ?? false}
                  fullWidth={props.fullWidth ?? false}
                />
              )}
            </For>
          </div>
        }
      >
        <Match when={props.variant === 'track'}>
          <Track {...props} />
        </Match>
        <Match when={touchStyle() === 'pill'}>
          <TouchPill {...props} />
        </Match>
        <Match when={touchStyle() === 'inset'}>
          <TouchInset {...props} />
        </Match>
        <Match when={touchStyle() === 'segmented'}>
          <TouchSegmented {...props} />
        </Match>
      </Switch>
    </KSegmentedControl>
  );
}

function OptionContent<T extends string>(props: {
  option: TabOption<T>;
  iconOnly: boolean;
  iconClass: string;
}) {
  return (
    <>
      <Show when={props.option.icon}>
        {(icon) => (
          <Dynamic component={icon()} class={cn('shrink-0', props.iconClass)} />
        )}
      </Show>
      <span
        class={cn(
          'truncate',
          props.iconOnly && props.option.icon !== undefined && 'sr-only'
        )}
      >
        {props.option.label}
      </span>
      <Show when={props.option.count !== undefined && !props.iconOnly}>
        <span class="text-ink-extra-muted tabular-nums">
          {props.option.count}
        </span>
      </Show>
    </>
  );
}

function PillOption<T extends string>(props: {
  option: TabOption<T>;
  size: TabsSize;
  iconOnly: boolean;
  fullWidth: boolean;
}) {
  const square = () => props.iconOnly && props.option.icon !== undefined;
  const item = () => (
    <KSegmentedControl.Item
      value={props.option.value}
      disabled={props.option.disabled}
      class={cn(
        'relative inline-flex min-w-0 shrink-0 rounded-full border text-ink-muted transition-colors duration-120 motion-reduce:transition-none',
        // Unselected options share the outline Button frame.
        'bg-control elevated not-touch:not-data-checked:hover:overlay-hover not-touch:not-data-checked:hover:text-ink',
        // The selected option takes the pressed fill, flat like a pressed Button.
        'data-checked:border-edge-button data-checked:overlay-active data-checked:text-ink data-checked:shadow-none',
        'has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        props.size === 'sm' && 'h-6',
        props.size === 'md' && 'h-8',
        props.size === 'lg' && 'h-9',
        square() && 'aspect-square',
        props.fullWidth && 'flex-1'
      )}
    >
      <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
      <KSegmentedControl.ItemLabel
        class={cn(
          'flex size-full min-w-0 items-center justify-center font-medium whitespace-nowrap select-none',
          props.size === 'sm' && 'gap-1 px-2 text-xs',
          props.size === 'md' && 'gap-1.5 px-3 text-sm',
          props.size === 'lg' && 'gap-2 px-4 text-sm',
          // Equal-width options are centred, so narrow rails keep whole labels.
          props.fullWidth && 'px-1.5',
          square() && 'px-0'
        )}
      >
        <OptionContent
          option={props.option}
          iconOnly={props.iconOnly}
          // Glyphs match a Button of the same size: smaller beside a label.
          iconClass={cn(
            props.size === 'sm' && (square() ? 'size-3.5' : 'size-3'),
            props.size === 'md' && (square() ? 'size-4' : 'size-3.5'),
            props.size === 'lg' && (square() ? 'size-5' : 'size-4')
          )}
        />
      </KSegmentedControl.ItemLabel>
    </KSegmentedControl.Item>
  );

  return (
    <Show when={square()} fallback={item()}>
      <Tooltip label={props.option.label}>{item()}</Tooltip>
    </Show>
  );
}

function Track<T extends string>(props: TabsProps<T>) {
  return (
    <div
      class={cn(
        'relative flex h-9 items-center rounded-full bg-ink/3',
        props.fullWidth && 'w-full'
      )}
    >
      <KSegmentedControl.Indicator class="pointer-events-none absolute top-0 left-0 z-0 rounded-full bg-panel bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--color-ink)_2%,transparent),transparent)] transition-[transform,width,height] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark-mode:bg-active light-mode:border light-mode:border-ink/7 light-mode:bg-none light-mode:shadow-[0_1px_6px_0_color-mix(in_srgb,var(--color-ink)_5%,transparent)]" />
      <For each={props.options}>
        {(option) => (
          <KSegmentedControl.Item
            value={option.value}
            disabled={option.disabled}
            class={cn(
              'relative z-1 inline-flex h-full min-w-0 items-center rounded-full',
              'has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus data-disabled:pointer-events-none data-disabled:opacity-50',
              props.fullWidth && 'flex-1'
            )}
          >
            <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
            <KSegmentedControl.ItemLabel
              class={cn(
                'flex h-full items-center gap-1.5 rounded-full px-4 text-sm font-medium whitespace-nowrap select-none text-ink-extra-muted hover:text-ink data-checked:text-ink transition-colors duration-120 motion-reduce:transition-none touch:px-2.5',
                props.fullWidth && 'w-full justify-center'
              )}
            >
              <OptionContent
                option={option}
                iconOnly={props.iconOnly ?? false}
                iconClass="size-3.5"
              />
            </KSegmentedControl.ItemLabel>
          </KSegmentedControl.Item>
        )}
      </For>
    </div>
  );
}

function TouchPill<T extends string>(props: TabsProps<T>) {
  return (
    <div
      class={cn(
        'relative flex items-center',
        props.size === 'lg' ? 'h-11' : 'h-8',
        props.fullWidth && 'w-full'
      )}
    >
      <KSegmentedControl.Indicator class="pointer-events-none absolute top-0 left-0 z-0 rounded-full border border-edge-frame bg-active transition-[transform,width,height] duration-50 motion-reduce:transition-none" />
      <For each={props.options}>
        {(option) => (
          <KSegmentedControl.Item
            value={option.value}
            disabled={option.disabled}
            class={cn(
              'relative z-1 inline-flex h-full min-w-0 items-center rounded-full',
              'has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus data-disabled:pointer-events-none data-disabled:opacity-50',
              props.fullWidth && 'flex-1'
            )}
          >
            <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
            <KSegmentedControl.ItemLabel
              class={cn(
                'flex h-full items-center gap-1.5 rounded-full px-4 text-xs font-medium whitespace-nowrap select-none text-ink-extra-muted hover:text-ink data-checked:text-ink transition-colors duration-120 motion-reduce:transition-none',
                props.fullWidth && 'w-full justify-center'
              )}
            >
              <OptionContent
                option={option}
                iconOnly={props.iconOnly ?? false}
                iconClass="size-3.5"
              />
            </KSegmentedControl.ItemLabel>
          </KSegmentedControl.Item>
        )}
      </For>
    </div>
  );
}

function TouchInset<T extends string>(props: TabsProps<T>) {
  return (
    <Layer depth={0}>
      <div
        class={cn(
          'relative flex items-center rounded-full border border-edge-muted bg-surface p-0.5 has-focus-visible:ring-2 has-focus-visible:ring-accent/20',
          props.fullWidth && 'w-full'
        )}
      >
        <For each={props.options}>
          {(option) => (
            <Layer depth={2}>
              <KSegmentedControl.Item
                value={option.value}
                disabled={option.disabled}
                class={cn(props.fullWidth && 'flex-1')}
              >
                <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
                <KSegmentedControl.ItemLabel
                  class={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap text-ink-extra-muted ring-inset hover:text-ink data-checked:bg-surface data-checked:text-ink data-checked:ring data-checked:ring-edge-muted data-checked:shadow-[0_1px_2px_rgba(0,0,0,0.06)]',
                    props.fullWidth && 'w-full justify-center'
                  )}
                  // Keep a focused input focused while switching.
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <OptionContent
                    option={option}
                    iconOnly={props.iconOnly ?? false}
                    iconClass="size-3.5"
                  />
                </KSegmentedControl.ItemLabel>
              </KSegmentedControl.Item>
            </Layer>
          )}
        </For>
      </div>
    </Layer>
  );
}

function TouchSegmented<T extends string>(props: TabsProps<T>) {
  return (
    <div
      class={cn(
        'inline-flex overflow-hidden rounded-full border border-edge-frame',
        props.size === 'sm' ? 'h-6' : 'h-8',
        props.fullWidth && 'flex w-full'
      )}
    >
      <For each={props.options}>
        {(option) => (
          <KSegmentedControl.Item
            value={option.value}
            disabled={option.disabled}
            class={cn(
              'relative flex h-full items-center justify-center border-r border-edge-divider font-medium outline-none last:border-r-0 has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus transition-colors duration-120 motion-reduce:transition-none',
              props.size === 'sm' ? 'px-2 text-xs' : 'px-3 text-sm',
              option.disabled
                ? 'opacity-50'
                : 'text-ink-muted active:overlay-active data-checked:text-ink data-checked:overlay-active',
              props.fullWidth && 'flex-1'
            )}
          >
            <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
            <KSegmentedControl.ItemLabel class="flex items-center gap-1.5">
              <OptionContent
                option={option}
                iconOnly={props.iconOnly ?? false}
                iconClass="size-3.5"
              />
            </KSegmentedControl.ItemLabel>
          </KSegmentedControl.Item>
        )}
      </For>
    </div>
  );
}
