import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { For, Show } from 'solid-js';
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

type SurfaceSlotProps = ParentProps<{ class?: string }>;

type ContentProps = ParentProps<{ class?: string }>;



const DEFAULT_PLACEMENT: Placement = 'bottom';
const TOOLTIP_OVERFLOW_PADDING = 16;
const TOOLTIP_VIEWPORT_PADDING = 16;
const TOOLTIP_FIT_VIEWPORT = true;
const TOOLTIP_GUTTER = 4;
const TOOLTIP_DELAY = 250;
const TOOLTIP_FLIP = true;

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

export type TooltipProps = ParentProps<{
  onOpenChange?: (open: boolean) => void;
  hotkeySequence?: HotkeySequenceStep[];
  ref?: (el: HTMLElement) => void;
  rows?: LabelAndHotKeyProps[];
  hotkeyToken?: HotkeyToken;
  tooltip?: JSX.Element;
  placement?: Placement;
  as?: 'div' | 'span';
  shortcut?: string;
  label?: string;
  class?: string;
  open?: boolean;
}>;

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
      gutter={TOOLTIP_GUTTER}
      flip={TOOLTIP_FLIP}
      overflowPadding={TOOLTIP_OVERFLOW_PADDING}
      fitViewport={TOOLTIP_FIT_VIEWPORT}
      openDelay={TOOLTIP_DELAY}
      closeDelay={TOOLTIP_DELAY}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Show when={isSugarMode()} fallback={props.children}>
        <TooltipTrigger as={props.as} ref={props.ref} class={props.class}>
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
