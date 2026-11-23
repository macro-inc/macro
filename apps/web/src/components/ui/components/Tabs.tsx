import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { SegmentedControl as KSegmentedControl } from '@kobalte/core/segmented-control';
import {
  type Component,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import {
  type LabeledControlSize,
  labeledControlContents as sharedControlContents,
  labeledControlFrames as sharedControlFrames,
  iconControlSizes as sharedIconControlSizes,
} from '../utils/control-sizes';
import { Layer } from './Layer';
import { Tooltip } from './Tooltip';

export type TabOption<T extends string> = {
  value: T;
  /** Accessible name, and the tooltip when the group is icon-only. */
  label: string;
  /** Accessible description on all inputs, also shown as a desktop pill tooltip. */
  tooltip?: string;
  icon?: Component<{ class?: string }>;
  /** Shown after the label in muted figures; strings retain caller formatting. */
  count?: number | string;
  /**
   * A small attention dot after the label; `violet` where what is new was
   * picked by AI, as the app's violet means.
   */
  dot?: boolean | 'violet';
  disabled?: boolean;
};

/** Button-sized pills; touch treatments keep their own minimum targets. */
export type TabsSize = LabeledControlSize | 'composer';

// Match a composer repository pill: 36px control, 8px label inset, 14px text with inherited line height.
const iconControlSizes = {
  ...sharedIconControlSizes,
  composer:
    'h-9 w-9 min-h-9 shrink-0 aspect-square p-0 text-sm leading-[inherit]',
};
const labeledControlFrames = { ...sharedControlFrames, composer: 'min-h-9' };
const labeledControlContents = {
  ...sharedControlContents,
  composer: 'px-2 py-0 text-sm leading-[inherit]',
};

const tabIconSizes: Record<TabsSize, { square: string; labeled: string }> = {
  xs: { square: 'size-3', labeled: 'size-3' },
  sm: { square: 'size-3.5', labeled: 'size-3' },
  md: { square: 'size-4', labeled: 'size-3.5' },
  lg: { square: 'size-5', labeled: 'size-4' },
  xl: { square: 'size-6', labeled: 'size-5' },
  composer: { square: 'size-4', labeled: 'size-4' },
};

// The grouped frame adds 2px of border and 4px of padding around each tab.
// Reserve the inset square explicitly; tooltip wrappers cannot resolve h-full
// against a track that only has a minimum height.
const joinedIconSizes: Record<TabsSize, string> = {
  xs: 'size-4.5',
  sm: 'size-5.5',
  md: 'size-6.5',
  lg: 'size-8.5',
  xl: 'size-10.5',
  composer: 'h-9 min-w-9',
};

function tabContentClasses(size: TabsSize) {
  return cn(labeledControlContents[size], size === 'md' && 'px-3');
}

/**
 * Desktop joins options inside one segmented frame. Touch keeps the treatment each
 * surface already had: a sliding pill, a bordered inset track, divided
 * segments, or separate pills.
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
      variant?: 'grouped' | 'pills' | 'choices' | 'choices-filled';
      size?: TabsSize;
      /** Let many options flow onto more lines; renders pills on touch too. */
      wrap?: boolean;
      touch?: TabsTouchStyle;
    }
  | {
      /**
       * Legacy track treatment, retained for Home; other value switches use grouped tabs.
       */
      variant: 'track';
      size?: never;
      wrap?: never;
      touch?: never;
    }
);

/**
 * One inline single choice: switch a view, a section, or a small set of
 * values. On desktop options share one flat rounded frame,
 * and the selected inset pill takes the pressed fill.
 *
 * @do Use for two to six short options that are all visible at once.
 * @do Put view tabs left of the header controls, after the title.
 * @do Use `iconOnly` to collapse a narrow header; keep `label` as the name.
 * @do Use `size` to match neighbouring controls: `md` beside 32px buttons.
 * @do Set `touch` to the look the surface had on touch: `pill` (sliding),
 *   `inset`, `segmented`, or `pills` for separate pills.
 * @dont Do not build tabs from Buttons, a ButtonGroup, or HeaderActionGroup.
 * @dont Do not put Tabs inside a HeaderActionGroup or ButtonGroup.
 * @dont Do not use Tabs for tabs that own panels or a dynamic collection; use TabSelector.
 * @dont Do not branch on `isTouchDevice()` to pick a tab component; set `touch`.
 * @dont Do not use the retained legacy `track` variant for new controls.
 */
export function Tabs<T extends string>(props: TabsProps<T>) {
  const select = (value: string) => {
    const option = props.options.find((option) => option.value === value);
    if (option) props.onChange(option.value);
  };
  const isChoice = () =>
    props.variant === 'choices' || props.variant === 'choices-filled';
  // Wrapping presets retain separate pills; desktop view tabs share a frame.
  const touchStyle = (): TabsTouchStyle =>
    isTouchDevice() && !props.wrap && !isChoice()
      ? (props.touch ?? 'pill')
      : 'pills';

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
              isChoice() && 'gap-1 touch:gap-1.5',
              !isChoice() &&
                (props.size === 'xs' || props.size === 'sm'
                  ? 'gap-1'
                  : 'gap-1.5'),
              props.variant === 'choices-filled' && 'gap-2',
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
                  choices={isChoice()}
                  filledChoices={props.variant === 'choices-filled'}
                />
              )}
            </For>
          </div>
        }
      >
        <Match when={props.variant === 'track'}>
          <Track {...props} />
        </Match>
        <Match
          when={
            !isTouchDevice() &&
            !props.wrap &&
            (props.variant === undefined || props.variant === 'grouped')
          }
        >
          <div
            class={cn(
              'inline-flex min-w-0 items-stretch overflow-hidden rounded-full border border-edge-button bg-control gap-0.5',
              props.size === 'composer'
                ? 'px-1 py-0 text-sm leading-[inherit]'
                : 'p-0.5',
              labeledControlFrames[props.size ?? 'md'],
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
                  joined
                />
              )}
            </For>
          </div>
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
  const iconOnly = () => props.iconOnly && props.option.icon !== undefined;
  const dotColor = () =>
    props.option.dot === 'violet' ? 'bg-violet' : 'bg-accent';
  return (
    <>
      <Show when={props.option.icon}>
        {(icon) => (
          <span class="relative inline-flex shrink-0">
            <Dynamic
              component={icon()}
              class={cn('shrink-0', props.iconClass)}
            />
            {/* An icon-only option carries its dot on the glyph's corner. */}
            <Show when={props.option.dot && iconOnly()}>
              <span
                aria-hidden="true"
                class={cn(
                  'absolute -top-0.5 -right-1 size-1.5 rounded-full',
                  dotColor()
                )}
              />
            </Show>
          </span>
        )}
      </Show>
      <span class={cn('truncate', iconOnly() && 'sr-only')}>
        {props.option.label}
      </span>
      <Show when={props.option.count !== undefined && !props.iconOnly}>
        <span class="text-ink-extra-muted tabular-nums">
          {props.option.count}
        </span>
      </Show>
      <Show when={props.option.dot && !iconOnly()}>
        <span
          aria-hidden="true"
          class={cn('size-1.5 shrink-0 rounded-full', dotColor())}
        />
      </Show>
    </>
  );
}

function PillOption<T extends string>(props: {
  option: TabOption<T>;
  size: TabsSize;
  iconOnly: boolean;
  fullWidth: boolean;
  joined?: boolean;
  choices?: boolean;
  filledChoices?: boolean;
}) {
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const square = () => props.iconOnly && props.option.icon !== undefined;
  // Full width shares the row equally, icon-only options too.
  const fixedSquare = () => square() && !props.fullWidth;
  const item = () => (
    <KSegmentedControl.Item
      value={props.option.value}
      disabled={props.option.disabled}
      class={cn(
        'relative inline-flex min-w-0 shrink-0 rounded-full border text-ink-muted transition-colors duration-120 motion-reduce:transition-none',
        props.choices
          ? 'group/choice h-6 touch:h-11 border-transparent text-ink-muted'
          : cn(
              props.joined
                ? 'self-stretch border-transparent data-checked:border-edge-button'
                : 'bg-control border-edge-button',
              'not-touch:not-data-checked:hover:overlay-hover not-touch:not-data-checked:hover:text-ink',
              'data-checked:overlay-active data-checked:text-ink'
            ),
        props.filledChoices && 'h-7',
        'shadow-none has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        !props.joined &&
          !props.choices &&
          (fixedSquare()
            ? iconControlSizes[props.size]
            : labeledControlFrames[props.size]),
        props.joined && fixedSquare() && joinedIconSizes[props.size],
        !props.choices && 'touch:min-h-8',
        square() && 'touch:min-w-8',
        props.fullWidth && 'flex-1'
      )}
    >
      <KSegmentedControl.ItemInput
        class="pointer-events-none absolute inset-0"
        aria-description={props.option.tooltip}
      />
      <KSegmentedControl.ItemLabel
        class={cn(
          'flex min-w-0 flex-1 items-center justify-center gap-2 font-medium whitespace-nowrap select-none',
          props.choices
            ? 'h-6 self-center rounded-full border border-edge-button bg-control px-2.5 text-xs leading-4 touch:h-7 touch:px-3 touch:text-xs group-data-checked/choice:bg-selected group-data-checked/choice:border-accent group-data-checked/choice:text-accent'
            : cn(
                'self-stretch',
                (!square() || props.size === 'composer') &&
                  tabContentClasses(props.size)
              ),
          props.filledChoices &&
            'h-7 bg-button-secondary-bg border-transparent text-ink-muted group-data-checked/choice:bg-accent group-data-checked/choice:border-transparent group-data-checked/choice:text-button-accent-ink',
          props.joined && 'py-0'
        )}
      >
        <OptionContent
          option={props.option}
          iconOnly={props.iconOnly}
          // Glyphs match a Button of the same size: smaller beside a label.
          iconClass={tabIconSizes[props.size][square() ? 'square' : 'labeled']}
        />
      </KSegmentedControl.ItemLabel>
    </KSegmentedControl.Item>
  );

  return (
    <Show
      when={square() || (!isTouchDevice() && props.option.tooltip)}
      fallback={item()}
    >
      <Tooltip.Root open={tooltipOpen()} onOpenChange={setTooltipOpen}>
        <Tooltip.Trigger
          as="div"
          onFocusIn={() => setTooltipOpen(true)}
          onFocusOut={() => setTooltipOpen(false)}
          class={cn(
            'inline-flex min-w-0 shrink-0 self-stretch items-center',
            props.fullWidth && 'flex-1'
          )}
        >
          {item()}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>
            {props.option.tooltip ?? props.option.label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
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
      <KSegmentedControl.Indicator class="pointer-events-none absolute top-0 left-0 z-0 rounded-full bg-panel transition-[transform,width,height] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark-mode:bg-active light-mode:border light-mode:border-ink/7" />
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
            <KSegmentedControl.ItemInput
              class="pointer-events-none absolute inset-0"
              aria-description={option.tooltip}
            />
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
  const size = () => props.size ?? 'md';
  return (
    <div
      class={cn(
        'relative flex min-h-8 items-center',
        size() === 'lg' && 'min-h-11',
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
              'relative z-1 inline-flex min-w-0 items-center rounded-full',
              'has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus data-disabled:pointer-events-none data-disabled:opacity-50',
              props.iconOnly && option.icon !== undefined
                ? iconControlSizes[size()]
                : labeledControlFrames[size()],
              'touch:min-h-8',
              size() === 'lg' && 'touch:min-h-11',
              props.iconOnly && option.icon !== undefined && 'touch:min-w-8',
              props.iconOnly &&
                option.icon !== undefined &&
                size() === 'lg' &&
                'touch:min-w-11',
              props.fullWidth &&
                !(props.iconOnly && option.icon !== undefined) &&
                'flex-1'
            )}
          >
            <KSegmentedControl.ItemInput
              class="pointer-events-none absolute inset-0"
              aria-description={option.tooltip}
            />
            <KSegmentedControl.ItemLabel
              class={cn(
                'flex min-w-0 flex-1 self-stretch items-center gap-1.5 rounded-full font-medium whitespace-nowrap select-none text-ink-extra-muted hover:text-ink data-checked:text-ink transition-colors duration-120 motion-reduce:transition-none',
                !(props.iconOnly && option.icon !== undefined) &&
                  tabContentClasses(size()),
                (props.fullWidth ||
                  (props.iconOnly && option.icon !== undefined)) &&
                  'justify-center'
              )}
            >
              <OptionContent
                option={option}
                iconOnly={props.iconOnly ?? false}
                iconClass={
                  tabIconSizes[size()][
                    props.iconOnly && option.icon !== undefined
                      ? 'square'
                      : 'labeled'
                  ]
                }
              />
            </KSegmentedControl.ItemLabel>
          </KSegmentedControl.Item>
        )}
      </For>
    </div>
  );
}

function TouchInset<T extends string>(props: TabsProps<T>) {
  const size = () => props.size ?? 'md';
  return (
    <Layer depth={0}>
      <div
        class={cn(
          'relative flex items-center rounded-full border border-edge-muted bg-surface has-focus-visible:ring-2 has-focus-visible:ring-accent/20',
          size() === 'composer'
            ? 'px-1 py-0 text-sm leading-[inherit]'
            : 'p-0.5',
          props.fullWidth && 'w-full'
        )}
      >
        <For each={props.options}>
          {(option) => (
            <Layer depth={2}>
              <KSegmentedControl.Item
                value={option.value}
                disabled={option.disabled}
                class={cn(
                  'relative inline-flex min-w-0 items-center rounded-full touch:min-h-8',
                  props.iconOnly && option.icon !== undefined
                    ? iconControlSizes[size()]
                    : labeledControlFrames[size()],
                  props.iconOnly &&
                    option.icon !== undefined &&
                    'touch:min-w-8',
                  props.fullWidth &&
                    !(props.iconOnly && option.icon !== undefined) &&
                    'flex-1'
                )}
              >
                <KSegmentedControl.ItemInput
                  class="pointer-events-none absolute inset-0"
                  aria-description={option.tooltip}
                />
                <KSegmentedControl.ItemLabel
                  class={cn(
                    'flex min-w-0 flex-1 self-stretch items-center gap-1.5 rounded-full font-medium whitespace-nowrap text-ink-extra-muted ring-inset hover:text-ink data-checked:bg-surface data-checked:text-ink data-checked:ring data-checked:ring-edge-muted',
                    (size() === 'composer' ||
                      !(props.iconOnly && option.icon !== undefined)) &&
                      tabContentClasses(size()),
                    (props.fullWidth ||
                      (props.iconOnly && option.icon !== undefined)) &&
                      'justify-center'
                  )}
                  // Keep a focused input focused while switching.
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <OptionContent
                    option={option}
                    iconOnly={props.iconOnly ?? false}
                    iconClass={
                      tabIconSizes[size()][
                        props.iconOnly && option.icon !== undefined
                          ? 'square'
                          : 'labeled'
                      ]
                    }
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
  const size = () => props.size ?? 'md';
  return (
    <div
      class={cn(
        'inline-flex min-h-8 overflow-hidden rounded-full border border-edge-frame',
        props.fullWidth && 'flex w-full'
      )}
    >
      <For each={props.options}>
        {(option) => (
          <KSegmentedControl.Item
            value={option.value}
            disabled={option.disabled}
            class={cn(
              'relative flex items-center justify-center border-r border-edge-divider font-medium outline-none last:border-r-0 has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus transition-colors duration-120 motion-reduce:transition-none',
              props.iconOnly && option.icon !== undefined
                ? iconControlSizes[size()]
                : labeledControlFrames[size()],
              'touch:min-h-8',
              props.iconOnly && option.icon !== undefined && 'touch:min-w-8',
              option.disabled
                ? 'opacity-50'
                : 'text-ink-muted active:overlay-active data-checked:text-ink data-checked:overlay-active',
              props.fullWidth &&
                !(props.iconOnly && option.icon !== undefined) &&
                'flex-1'
            )}
          >
            <KSegmentedControl.ItemInput
              class="pointer-events-none absolute inset-0"
              aria-description={option.tooltip}
            />
            <KSegmentedControl.ItemLabel
              class={cn(
                'flex min-w-0 flex-1 self-stretch items-center justify-center gap-1.5',
                !(props.iconOnly && option.icon !== undefined) &&
                  tabContentClasses(size())
              )}
            >
              <OptionContent
                option={option}
                iconOnly={props.iconOnly ?? false}
                iconClass={
                  tabIconSizes[size()][
                    props.iconOnly && option.icon !== undefined
                      ? 'square'
                      : 'labeled'
                  ]
                }
              />
            </KSegmentedControl.ItemLabel>
          </KSegmentedControl.Item>
        )}
      </For>
    </div>
  );
}
