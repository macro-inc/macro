import type { Placement } from '@floating-ui/dom';
import { Tooltip as KTooltip } from '@kobalte/core/tooltip';
import { type ParentProps, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface } from './Surface';
export function Tooltip(
  props: ParentProps<{
    label: string;
    disabled?: boolean;
    placement?: Placement;
    as?: 'div' | 'span';
    class?: string;
    hotkey?: string | string[];
    shortcut?: string | string[];
  }>
) {
  return (
    <Show when={!props.disabled} fallback={props.children}>
      <KTooltip
        placement={props.placement ?? 'bottom'}
        openDelay={400}
        closeDelay={0}
        gutter={4}
      >
        <KTooltip.Trigger
          as={props.as ?? 'span'}
          class={cn('inline-flex', props.class)}
        >
          {props.children}
        </KTooltip.Trigger>
        <KTooltip.Portal>
          <KTooltip.Content class="z-tool-tip">
            <Surface
              depth={3}
              hideBorder
              class="flex items-center justify-center rounded-lg bg-tooltip p-2 text-xs text-ink-muted wrap-break-word"
            >
              {props.label}
            </Surface>
          </KTooltip.Content>
        </KTooltip.Portal>
      </KTooltip>
    </Show>
  );
}
