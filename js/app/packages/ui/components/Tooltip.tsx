import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps } from 'solid-js';
import { For, Show } from 'solid-js';
import { cn, Surface } from '@ui';

type SurfaceSlotProps = ParentProps<{ class?: string }>;

type ContentProps = ParentProps<{ class?: string }>;

/** Props shared by both sugar mode and compound mode. */
type CommonTooltipProps = {
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  open?: boolean;
};

/**
 * Props that configure the auto-generated `<Tooltip.Trigger>` element
 * Tooltip renders in sugar mode. In compound mode these belong on
 * `<Tooltip.Trigger>` directly, so they are forbidden on the root.
 */
type TriggerForwardingProps = {
  as?: 'div' | 'span';
  ref?: (el: HTMLElement) => void;
  class?: string;
};

/** Sugar variant: pre-built multi-row tooltip from `rows`. */
type RowsSugarProps = {
  rows: LabelAndHotKeyProps[];
  label?: never;
  tooltip?: never;
  hotkeyToken?: never;
  shortcut?: never;
  hotkeySequence?: never;
};

/** Sugar variant: pre-built single-row tooltip from `label` (+ optional hotkey). */
type LabelSugarProps = {
  label: string;
  rows?: never;
  tooltip?: never;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  hotkeySequence?: HotkeySequenceStep[];
};

/** Sugar variant: arbitrary JSX/string content via `tooltip`. */
type TooltipSugarProps = {
  tooltip: JSX.Element;
  label?: never;
  rows?: never;
  hotkeyToken?: never;
  shortcut?: never;
  hotkeySequence?: never;
};

/**
 * One of `rows` / `label` / `tooltip` is required; the others are forbidden.
 * Trigger-forwarding props (`as`, `ref`, `class`) are allowed here because
 * Tooltip itself owns the `<Tooltip.Trigger>` in this mode.
 */
export type SugarTooltipProps = ParentProps<
  CommonTooltipProps &
    TriggerForwardingProps &
    (RowsSugarProps | LabelSugarProps | TooltipSugarProps)
>;

/**
 * Compound mode: the caller composes `<Tooltip.Trigger>` /
 * `<Tooltip.Content>` themselves. All sugar fields and trigger-forwarding
 * fields are forbidden on the root — they belong on the child slots.
 */
export type CompoundTooltipProps = ParentProps<
  CommonTooltipProps & {
    tooltip?: never;
    label?: never;
    rows?: never;
    hotkeyToken?: never;
    shortcut?: never;
    hotkeySequence?: never;
    as?: never;
    ref?: never;
    class?: never;
  }
>;

export type TooltipProps = SugarTooltipProps | CompoundTooltipProps;

type LabelAndHotKeyProps = {
  hotkeySequence?: HotkeySequenceStep[];
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  label: string;
};

export type HotkeySequenceStep = {
  token?: HotkeyToken;
  shortcut?: string;
};

type TriggerProps = ParentProps<{
  as?: 'div' | 'span';
  ref?: (el: HTMLElement) => void;
  class?: string;
}>;

const DEFAULT_PLACEMENT: Placement = 'bottom';
const TOOLTIP_OVERFLOW_PADDING = 16;
const TOOLTIP_VIEWPORT_PADDING = 16;
const TOOLTIP_FIT_VIEWPORT = true;
const TOOLTIP_GUTTER = 4;
const TOOLTIP_DELAY = 250;
const TOOLTIP_FLIP = true;

function TooltipTrigger(props: TriggerProps) {
  return (
    <KobalteTooltip.Trigger
      as={props.as ?? 'div'}
      ref={(el: HTMLElement) => { props.ref?.(el); }}
      class={cn('inline-flex items-center', props.class)}
    >
      {props.children}
    </KobalteTooltip.Trigger>
  );
}

function TooltipContent(props: ContentProps) {
  return (
    <KobalteTooltip.Portal>
      <KobalteTooltip.Content
        style={{ 'max-width': `calc(100vw - ${2 * TOOLTIP_VIEWPORT_PADDING}px)` }}
        class={cn('z-tool-tip', props.class)}
      >
        {props.children}
      </KobalteTooltip.Content>
    </KobalteTooltip.Portal>
  );
}

function TooltipSurface(props: SurfaceSlotProps) {
  return (
    <Surface
      depth={3}
      class={cn(
        'flex items-center justify-center p-1.5 text-ink-muted text-xs wrap-break-word',
        props.class
      )}
    >
      {props.children}
    </Surface>
  );
}

function LabelAndHotKey(props: LabelAndHotKeyProps) {
  const steps = (): HotkeySequenceStep[] => {
    if (props.hotkeySequence?.length) { return props.hotkeySequence; }
    if (props.hotkeyToken || props.shortcut) { return [{ token: props.hotkeyToken, shortcut: props.shortcut }]; }
    return [];
  };

  return (
    <div
      class={cn(
        'flex flex-row items-center space-x-2',
        steps().length === 0 ? 'px-1' : 'px-0'
      )}
    >
      <div class="text-xs capitalize">{props.label}</div>
      <Show when={steps().length > 0}>
        <div class="flex items-center gap-1 ml-auto">
          <For each={steps()}>
            {(step, ndx) => (
              <>
                <Hotkey
                  shortcut={step.shortcut}
                  token={step.token}
                  theme="subtle"
                />
                <Show when={ndx() < steps().length - 1}>
                  <span class="text-ink-extra-muted">then</span>
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/**
 * @example
 * <Tooltip tooltip="Close"><Button>X</Button></Tooltip>
 *
 * <Tooltip label="Zoom" hotkeyToken={TOKENS.canvas.zoomInTool}>
 *   <Button>Zoom</Button>
 * </Tooltip>
 *
 * **Compound mode** — when no sugar content is provided, the root just sets
 * up the Kobalte tooltip context and forwards `children` verbatim. Compose
 * `<Tooltip.Trigger>` + `<Tooltip.Content>` (+ optional `<Tooltip.Surface>`)
 * inside.
 *
 * @example
 * const [open, setOpen] = createSignal(false);
 * return (
 *   <Tooltip open={open()} onOpenChange={setOpen} placement="left">
 *     <Tooltip.Trigger as="span">{avatar}</Tooltip.Trigger>
 *     <Tooltip.Content>
 *       <UserTooltip onClose={() => setOpen(false)} ... />
 *     </Tooltip.Content>
 *   </Tooltip>
 * );
 */
export function Tooltip(props: TooltipProps) {
  const sugarContent = (): JSX.Element | undefined => {
    if (props.rows && props.rows.length > 0) {
      return (
        <div class="flex flex-col">
          <For each={props.rows}>{(row) => <LabelAndHotKey {...row} />}</For>
        </div>
      );
    }
    if (props.label !== undefined) {
      return (
        <LabelAndHotKey
          hotkeySequence={props.hotkeySequence}
          hotkeyToken={props.hotkeyToken}
          shortcut={props.shortcut}
          label={props.label}
        />
      );
    }
    return props.tooltip;
  };

  const isSugarMode = () =>
    props.tooltip !== undefined ||
    props.label !== undefined ||
    (props.rows !== undefined && props.rows.length > 0);

  return (
    <KobalteTooltip
      placement={props.placement ?? DEFAULT_PLACEMENT}
      overflowPadding={TOOLTIP_OVERFLOW_PADDING}
      fitViewport={TOOLTIP_FIT_VIEWPORT}
      onOpenChange={props.onOpenChange}
      closeDelay={TOOLTIP_DELAY}
      openDelay={TOOLTIP_DELAY}
      gutter={TOOLTIP_GUTTER}
      flip={TOOLTIP_FLIP}
      open={props.open}
    >
      <Show when={isSugarMode()} fallback={props.children}>
        <TooltipTrigger
          class={props.class}
          ref={props.ref}
          as={props.as}
        >
          {props.children}
        </TooltipTrigger>
        <TooltipContent>
          <TooltipSurface>{sugarContent()}</TooltipSurface>
        </TooltipContent>
      </Show>
    </KobalteTooltip>
  );
}

Tooltip.Trigger = TooltipTrigger;
Tooltip.Content = TooltipContent;
Tooltip.Surface = TooltipSurface;
