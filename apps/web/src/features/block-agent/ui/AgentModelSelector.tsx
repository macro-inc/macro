/**
 * The session's model, as a pill that opens the harness's own model list.
 *
 * Everything here is harness-reported: the options come from the runtime's
 * ACP `configOptions` and the current model is the fold's rejection-safe
 * projection of them, so this component never needs a model registry of its
 * own. Renders nothing until the harness has advertised its models.
 *
 * Harnesses advertise as many models as they like, so the list scrolls rather
 * than growing without bound: it shows at most `MAX_VISIBLE_ROWS` (or fewer,
 * when the popper has less room than that), leaving the next row half-cut
 * under a gradient so the overflow is visible rather than merely scrollable.
 */

import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import type { ModelOption } from '@service-agent-fold/generated/types';
import { cn, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

/** Height of one model row — `h-7` on the item, so the cap is exact. */
const ROW_HEIGHT_PX = 28;
/** Rows shown in full before the list starts scrolling. */
const MAX_VISIBLE_ROWS = 10;
/** The scroll container's own top padding, inside the capped window. */
const LIST_PADDING_PX = 6;

/**
 * Ten whole rows plus half of the eleventh, clamped to the room the popper
 * actually has (Kobalte's size middleware publishes that on the content
 * element, so a short screen caps the list before the row count does).
 */
const LIST_MAX_HEIGHT = `min(${
  LIST_PADDING_PX + MAX_VISIBLE_ROWS * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2
}px, calc(var(--kb-popper-content-available-height, 100vh) - 4px))`;

export interface AgentModelSelectorProps {
  /** Current model id, when the fold has learned it. */
  model: string | null;
  /**
   * A change to this model is on the wire. The pill shows it, shimmering,
   * so the switch is visibly in progress rather than appearing not to have
   * registered — the request can block for a whole container resume.
   */
  changingTo?: string;
  /** The models the harness offers, in the order it listed them. */
  options: ModelOption[];
  disabled?: boolean;
  /** Receives the id of the model to switch to. */
  onSelect: (model: string) => void;
}

export function AgentModelSelector(props: AgentModelSelectorProps) {
  const [listRef, setListRef] = createSignal<HTMLElement>();
  const shown = () => props.changingTo ?? props.model;
  const label = () =>
    props.options.find((option) => option.id === shown())?.name ??
    shown() ??
    'Model';

  return (
    <Show when={props.options.length > 0}>
      <Dropdown placement="top-start">
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          class="h-6 gap-1 rounded-full bg-ink/5 px-2 text-xs text-ink-muted hover:bg-ink/10"
          disabled={props.disabled || props.changingTo !== undefined}
        >
          <TextShimmer text={label()} active={props.changingTo !== undefined} />
          <CaretDown />
        </Dropdown.Trigger>
        <Dropdown.Content class="overflow-hidden">
          {/* The gradients anchor here, outside the scrolling box, and read
              the menu background through `--color-surface`. */}
          <div class="relative [--color-surface:var(--color-menu)]">
            <Dropdown.Group
              ref={setListRef}
              class="overflow-y-auto overscroll-contain p-0"
              style={{ 'max-height': LIST_MAX_HEIGHT }}
            >
              <div class="flex flex-col p-1.5">
                <For each={props.options}>
                  {(option) => (
                    <Dropdown.Item
                      class={cn(
                        'h-7 shrink-0 gap-2',
                        option.id === shown() && 'text-ink font-medium'
                      )}
                      title={option.description ?? undefined}
                      onSelect={() => {
                        if (option.id !== props.model)
                          props.onSelect(option.id);
                      }}
                    >
                      <span class="flex-1 truncate text-xs">{option.name}</span>
                    </Dropdown.Item>
                  )}
                </For>
              </div>
            </Dropdown.Group>
            <ScrollIndicators scrollRef={listRef} appearance="gradient" />
          </div>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
