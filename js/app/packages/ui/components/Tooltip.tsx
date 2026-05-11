import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { For, mergeProps, Show } from 'solid-js';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps } from 'solid-js';
import { cn, Surface } from '@ui';

export type HotkeySequenceStep = {
  token?: HotkeyToken;
  shortcut?: string;
};

type LabelAndHotKeyProps = {
  hotkeySequence?: HotkeySequenceStep[];
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  label: string;
};

const TOOLTIP_DELAY = 250;
const DEFAULT_VIEWPORT_PADDING = 16;

// ---------------------------------------------------------------------------
// Compound primitives
//
// Use these directly when you need full control (custom chrome, controlled
// open state, etc.):
//
//   <Tooltip open={open()} onOpenChange={setOpen} placement="left">
//     <Tooltip.Trigger as="span">{trigger}</Tooltip.Trigger>
//     <Tooltip.Content>
//       <CustomThing onClose={() => setOpen(false)} />
//     </Tooltip.Content>
//   </Tooltip>
//
// To opt into the default styled chrome (border, bg, padding) wrap your
// content in `<Tooltip.Surface>`. The sugar API on the root component below
// adds Trigger + Content + Surface for you automatically.
// ---------------------------------------------------------------------------

type TriggerProps = ParentProps<{
  as?: 'div' | 'span';
  ref?: (el: HTMLElement) => void;
  class?: string;
}>;

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

type ContentProps = ParentProps<{
  class?: string;
  /** Padding kept between the tooltip content and the viewport edge (max-width calc). */
  viewportPadding?: number;
}>;

function TooltipContent(props: ContentProps) {
  const padding = () => props.viewportPadding ?? DEFAULT_VIEWPORT_PADDING;
  return (
    <KobalteTooltip.Portal>
      <KobalteTooltip.Content
        style={{ 'max-width': `calc(100vw - ${2 * padding()}px)` }}
        class={cn('z-tool-tip', props.class)}
      >
        {props.children}
      </KobalteTooltip.Content>
    </KobalteTooltip.Portal>
  );
}

type SurfaceSlotProps = ParentProps<{ class?: string }>;

/**
 * Default visual chrome for sugar-mode tooltips: small muted text inside a
 * depth-3 `<Surface>`. Compound-mode callers that want chrome can either use
 * this preset, or drop in `<Surface>` directly when they need different
 * dimensions / depth / active highlighting (e.g. richer cards).
 */
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

// ---------------------------------------------------------------------------
// Root + sugar
// ---------------------------------------------------------------------------

export type TooltipProps = ParentProps<{
  // ----- Sugar content props (mutually exclusive convenience) -----
  /** Plain string or JSX rendered inside the default styled surface. */
  tooltip?: JSX.Element;
  /** Label for a single-row tooltip; combine with `hotkeyToken`, `shortcut`, or `hotkeySequence`. */
  label?: string;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  hotkeySequence?: HotkeySequenceStep[];
  /** Multi-row tooltip; each entry renders as its own row. */
  rows?: LabelAndHotKeyProps[];

  // ----- Sugar trigger props (used when sugar content is present) -----
  /** Element type for the trigger wrapper (sugar mode only). */
  as?: 'div' | 'span';
  ref?: (el: HTMLElement) => void;
  class?: string;

  // ----- Positioning (forwarded to Kobalte) -----
  placement?: Placement;
  gutter?: number;
  flip?: boolean | string;
  overflowPadding?: number;
  fitViewport?: boolean;
  viewportPadding?: number;

  // ----- Delays -----
  openDelay?: number;
  closeDelay?: number;

  // ----- Controlled open state (for compound usage that needs to close from inside) -----
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;

/**
 * Tooltip component. Has two usage modes:
 *
 * **Sugar mode** — pass `tooltip` / `label` / `rows`; the component renders a
 * styled tooltip and uses its `children` as the trigger.
 *
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
  const merged = mergeProps(
    {
      placement: 'bottom' as Placement,
      flip: true as boolean | string,
      overflowPadding: 16,
      viewportPadding: DEFAULT_VIEWPORT_PADDING,
      fitViewport: true,
      gutter: 4,
      openDelay: TOOLTIP_DELAY,
      closeDelay: TOOLTIP_DELAY,
    },
    props
  );

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
      placement={merged.placement}
      gutter={merged.gutter}
      flip={merged.flip}
      overflowPadding={merged.overflowPadding}
      fitViewport={merged.fitViewport}
      openDelay={merged.openDelay}
      closeDelay={merged.closeDelay}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Show when={isSugarMode()} fallback={props.children}>
        <TooltipTrigger as={props.as} ref={props.ref} class={props.class}>
          {props.children}
        </TooltipTrigger>
        <TooltipContent viewportPadding={merged.viewportPadding}>
          <TooltipSurface>{sugarContent()}</TooltipSurface>
        </TooltipContent>
      </Show>
    </KobalteTooltip>
  );
}

Tooltip.Trigger = TooltipTrigger;
Tooltip.Content = TooltipContent;
Tooltip.Surface = TooltipSurface;

/**
 * Renders a label with optional keyboard shortcut badge(s).
 * Internal to the Tooltip component — callers should use the flat
 * `label` / `hotkeyToken` / `shortcut` / `hotkeySequence` / `rows` props
 * on `<Tooltip>` (or `<Button>`) instead.
 */
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
