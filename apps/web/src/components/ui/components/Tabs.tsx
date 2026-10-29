import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { SegmentedControl as KSegmentedControl } from '@kobalte/core/segmented-control';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  Match,
  on,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import {
  iconControlSizes,
  type LabeledControlSize,
  labeledControlContents,
  labeledControlFrames,
} from '../utils/control-sizes';
import { Layer } from './Layer';
import { ToggleSwitch } from './ToggleSwitch';
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

/** Button-sized pills; touch treatments keep their own minimum targets. */
export type TabsSize = LabeledControlSize;

const tabIconSizes: Record<TabsSize, { square: string; labeled: string }> = {
  xs: { square: 'size-3', labeled: 'size-3' },
  sm: { square: 'size-3.5', labeled: 'size-3' },
  md: { square: 'size-4', labeled: 'size-3.5' },
  lg: { square: 'size-5', labeled: 'size-4' },
  xl: { square: 'size-6', labeled: 'size-5' },
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

export type TabsToggle = {
  label: string;
  /** Shown in the switch track so the switch reads without its label. */
  icon?: Component<{ class?: string }>;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

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
  /**
   * An on/off view filter after the options, such as "Unread". The desktop
   * frame holds it past a divider as one more segment, raised like a selected
   * option while on; elsewhere it follows the options.
   */
  toggle?: TabsToggle;
  /** Placement only (margins, width, alignment); never restyle the options. */
  class?: string;
  ref?: (element: HTMLElement) => void;
} & (
  | {
      variant?: 'grouped' | 'pills';
      size?: TabsSize;
      /** Let many options flow onto more lines; renders pills on touch too. */
      wrap?: boolean;
      touch?: TabsTouchStyle;
    }
  | {
      /**
       * One flat pill slides along a filled track, on every device. Only for
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
 * @dont Do not use `variant="track"` outside the agent composer's tray.
 */
export function Tabs<T extends string>(props: TabsProps<T>) {
  const select = (value: string) => {
    const option = props.options.find((option) => option.value === value);
    if (option) props.onChange(option.value);
  };
  // Wrapping presets retain separate pills; desktop view tabs share a frame.
  const touchStyle = (): TabsTouchStyle =>
    isTouchDevice() && !props.wrap ? (props.touch ?? 'pill') : 'pills';
  const joined = () =>
    props.variant !== 'track' &&
    !isTouchDevice() &&
    !props.wrap &&
    props.variant !== 'pills';
  // A narrow toggle frame first drops the toggle's text, then shows options
  // as their icons when every option has one (see ToggleFrame).
  const [collapseStage, setCollapseStage] = createSignal(0);
  const iconOnly = () => (props.iconOnly ?? false) || collapseStage() >= 2;
  const maxCollapseStage = () =>
    props.options.every((option) => option.icon !== undefined) ? 2 : 1;
  // With a toggle the frame is soft: a borderless filled track whose selected
  // option and pressed toggle are borderless fills too.
  const frameClass = () =>
    cn(
      'inline-flex min-w-0 items-stretch overflow-hidden rounded-full',
      props.toggle
        ? 'bg-active gap-0.5 p-1'
        : 'border border-edge-button bg-control gap-0.5 p-0.5',
      labeledControlFrames[props.size ?? 'md'],
      props.fullWidth && 'w-full'
    );

  // The toggle sits beside the segmented control, not inside its radio group.
  const control = (rootClass: string | undefined) => (
    <KSegmentedControl
      ref={props.ref}
      aria-label={props['aria-label']}
      value={props.value ?? ''}
      onChange={select}
      disabled={props.disabled}
      class={cn('relative inline-flex min-w-0 items-center', rootClass)}
    >
      <Switch
        fallback={
          <div
            class={cn(
              'flex min-w-0 items-center',
              props.wrap && 'flex-wrap',
              props.size === 'xs' || props.size === 'sm' ? 'gap-1' : 'gap-1.5',
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
        <Match when={joined()}>
          <div
            class={
              props.toggle
                ? 'flex min-w-0 flex-1 items-stretch gap-0.5'
                : frameClass()
            }
          >
            <For each={props.options}>
              {(option) => (
                <PillOption
                  option={option}
                  size={props.size ?? 'md'}
                  iconOnly={iconOnly()}
                  // Beside a toggle, options keep their label widths and share
                  // what is left, so no label truncates before it must.
                  fullWidth={(props.fullWidth ?? false) && !props.toggle}
                  soft={props.toggle !== undefined}
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

  return (
    <Show
      when={props.toggle}
      fallback={control(cn(props.fullWidth && 'flex w-full', props.class))}
    >
      {(toggle) => (
        <ToggleFrame
          class={cn(
            joined() ? frameClass() : 'inline-flex min-w-0 items-center gap-2',
            props.fullWidth && 'flex w-full',
            props.class
          )}
          toggle={toggle()}
          size={props.size ?? 'md'}
          joined={joined()}
          optionCount={props.options.length}
          stage={collapseStage()}
          maxStage={maxCollapseStage()}
          onStageChange={setCollapseStage}
        >
          {control(
            cn(
              joined() && 'flex-1 items-stretch',
              !joined() && props.fullWidth && 'flex-1'
            )
          )}
        </ToggleFrame>
      )}
    </Show>
  );
}

/**
 * Holds the options and the toggle. When an option label would truncate, a
 * narrow frame first drops the toggle's text (shown as a tooltip), then shows
 * the options as icons (labels become tooltips). Each step undoes only once
 * the frame has grown by what the labels were short when it was taken, so
 * undoing it cannot truncate them again and flip back.
 */
function ToggleFrame(
  props: ParentProps<{
    class: string;
    toggle: TabsToggle;
    size: TabsSize;
    joined: boolean;
    optionCount: number;
    stage: number;
    maxStage: number;
    onStageChange: (stage: number) => void;
  }>
) {
  const [frame, setFrame] = createSignal<HTMLElement>();
  const frameSize = createElementSize(frame);
  const expandAtWidth: number[] = [];
  createEffect(
    on(
      () => [frameSize.width, props.optionCount, props.stage] as const,
      ([width, , stage]) => {
        const element = frame();
        if (!element || width === null) return;
        if (stage > 0 && width >= (expandAtWidth[stage] ?? 0)) {
          props.onStageChange(stage - 1);
          return;
        }
        if (stage >= props.maxStage) return;
        let shortfall = 0;
        for (const label of element.querySelectorAll('[data-tab-label]')) {
          shortfall += label.scrollWidth - label.clientWidth;
        }
        if (shortfall <= 0) return;
        expandAtWidth[stage + 1] = width + shortfall;
        props.onStageChange(stage + 1);
      }
    )
  );

  return (
    <div ref={setFrame} class={props.class}>
      {props.children}
      <Show when={props.joined}>
        <span aria-hidden="true" class="my-1 w-px shrink-0 bg-edge-button" />
      </Show>
      <ToggleSegment
        toggle={props.toggle}
        size={props.size}
        joined={props.joined}
        collapsed={props.stage >= 1}
      />
    </div>
  );
}

function ToggleSegment(props: {
  toggle: TabsToggle;
  size: TabsSize;
  joined: boolean;
  collapsed: boolean;
}) {
  return (
    <Tooltip
      label={props.toggle.label}
      disabled={!props.collapsed}
      class={cn('shrink-0', props.joined && 'self-stretch')}
    >
      <ToggleSwitch
        size={
          props.size === 'xs'
            ? 'xs'
            : props.size === 'lg' || props.size === 'xl'
              ? 'md'
              : 'sm'
        }
        label={props.toggle.label}
        labelClass={props.collapsed ? 'sr-only' : undefined}
        trackIcon={props.toggle.icon}
        checked={props.toggle.checked}
        onChange={props.toggle.onChange}
        // A view filter, not a setting: a neutral borderless track.
        controlClass="border-transparent bg-ink/15 data-checked:border-transparent data-checked:bg-ink/60"
        class={cn(
          'shrink-0 rounded-full border border-transparent font-medium whitespace-nowrap text-ink-muted transition-colors duration-120 select-none motion-reduce:transition-none',
          'not-touch:not-data-checked:hover:overlay-hover not-touch:not-data-checked:hover:text-ink',
          'data-checked:overlay-active data-checked:text-ink',
          labeledControlContents[props.size],
          props.collapsed && 'px-1',
          props.joined && 'self-stretch py-0'
        )}
      />
    </Tooltip>
  );
}

function OptionContent<T extends string>(props: {
  option: TabOption<T>;
  iconOnly: boolean;
  hideIcon?: boolean;
  iconClass: string;
}) {
  return (
    <>
      <Show when={!props.hideIcon && props.option.icon}>
        {(icon) => (
          <Dynamic component={icon()} class={cn('shrink-0', props.iconClass)} />
        )}
      </Show>
      <span
        data-tab-label=""
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
  /** Size to the label and drop the selected border, beside a toggle. */
  soft?: boolean;
  joined?: boolean;
}) {
  const square = () => props.iconOnly && props.option.icon !== undefined;
  const item = () => (
    <KSegmentedControl.Item
      value={props.option.value}
      disabled={props.option.disabled}
      class={cn(
        'relative inline-flex min-w-0 shrink-0 rounded-full border text-ink-muted transition-colors duration-120 motion-reduce:transition-none',
        props.joined
          ? cn(
              'self-stretch border-transparent',
              !props.soft && 'data-checked:border-edge-button'
            )
          : 'bg-control border-edge-button',
        'shadow-none not-touch:not-data-checked:hover:overlay-hover not-touch:not-data-checked:hover:text-ink',
        'data-checked:overlay-active data-checked:text-ink',
        'has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        !props.joined &&
          (square()
            ? iconControlSizes[props.size]
            : labeledControlFrames[props.size]),
        props.joined && square() && joinedIconSizes[props.size],
        'touch:min-h-8',
        square() && 'touch:min-w-8',
        props.fullWidth && !square() && 'flex-1',
        props.soft && !square() && 'flex-auto'
      )}
    >
      <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
      <KSegmentedControl.ItemLabel
        class={cn(
          'flex min-w-0 flex-1 self-stretch items-center justify-center gap-2 font-medium whitespace-nowrap select-none',
          !square() && tabContentClasses(props.size),
          props.soft && 'px-1.5',
          props.joined && 'py-0'
        )}
      >
        <OptionContent
          option={props.option}
          iconOnly={props.iconOnly}
          // Soft options show their icon only once collapsed to icons.
          hideIcon={props.soft === true && !props.iconOnly}
          // Glyphs match a Button of the same size: smaller beside a label.
          iconClass={tabIconSizes[props.size][square() ? 'square' : 'labeled']}
        />
      </KSegmentedControl.ItemLabel>
    </KSegmentedControl.Item>
  );

  return (
    <Show when={square()} fallback={item()}>
      <Tooltip
        label={props.option.label}
        // Soft icon options share the frame's width, each icon centered.
        class={cn('shrink-0', props.soft && 'flex-1 justify-center')}
      >
        {item()}
      </Tooltip>
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
            <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
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
                class={cn(
                  'inline-flex min-w-0 items-center rounded-full touch:min-h-8',
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
                <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
                <KSegmentedControl.ItemLabel
                  class={cn(
                    'flex min-w-0 flex-1 self-stretch items-center gap-1.5 rounded-full font-medium whitespace-nowrap text-ink-extra-muted ring-inset hover:text-ink data-checked:bg-surface data-checked:text-ink data-checked:ring data-checked:ring-edge-muted',
                    !(props.iconOnly && option.icon !== undefined) &&
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
            <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
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
