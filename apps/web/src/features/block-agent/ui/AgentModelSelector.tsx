/**
 * The session's model, as a pill that opens the harness's own model list.
 *
 * Everything here is harness-reported: the options come from the runtime's
 * ACP `configOptions` and the current model is the fold's rejection-safe
 * projection of them, so this component never needs a model registry of its
 * own. Renders nothing until the harness has advertised its models.
 *
 * Touch devices get a bottom sheet (`MobileDrawer`, the same chrome as the
 * split title menu) listing every model with a check on the current one.
 * Desktop keeps a popover: a compact scrolling list for short catalogs, the
 * searchable `ModelCatalogPicker` for long ones.
 *
 * Harnesses advertise as many models as they like, so the desktop list
 * scrolls rather than growing without bound: it shows at most
 * `MAX_VISIBLE_ROWS` (or fewer, when the popper has less room than that),
 * leaving the next row half-cut under a gradient so the overflow is visible
 * rather than merely scrollable.
 */

import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { isLargeModelCatalog } from '@core/component/AI/component/input/modelCatalog';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import Check from '@phosphor/check.svg';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import type { ModelOption } from '@service-agent-fold/generated/types';
import { Button, cn, Dropdown } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

/** Compact ghost pill — same size as the short-list trigger and chat's selector. */
const PILL_TRIGGER_CLASS =
  'h-6 w-auto max-w-[9rem] min-w-0 justify-start gap-1 rounded-full border-transparent bg-ink/5 px-2 text-left text-xs text-ink-muted hover:bg-ink/10';

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
  /** Returns focus to the session composer after Escape dismisses the menu. */
  onEscape?: () => void;
}

/** Consecutive options under one harness heading (`null` = no heading). */
type ModelGroup = { label: string | null; options: ModelOption[] };

function groupOptions(options: ModelOption[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const option of options) {
    const label = option.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.options.push(option);
    else groups.push({ label, options: [option] });
  }
  return groups;
}

export function AgentModelSelector(props: AgentModelSelectorProps) {
  const [listRef, setListRef] = createSignal<HTMLElement>();
  const [sheetOpen, setSheetOpen] = createSignal(false);
  let shortListDismissedWithEscape = false;
  const shown = () => props.changingTo ?? props.model;
  const label = () =>
    props.options.find((option) => option.id === shown())?.name ??
    shown() ??
    'Model';
  const catalogOptions = () =>
    props.options.map((option) => ({
      id: option.id,
      label: option.name,
      description: option.description ?? undefined,
      group: option.group ?? undefined,
    }));
  const useCatalog = () => isLargeModelCatalog(catalogOptions());
  const groups = createMemo(() => groupOptions(props.options));
  const disabled = () => props.disabled || props.changingTo !== undefined;

  const pick = (id: string) => {
    setSheetOpen(false);
    if (id !== props.model) props.onSelect(id);
  };

  const sheet = (
    <MobileDrawer
      side="bottom"
      open={sheetOpen()}
      onOpenChange={setSheetOpen}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      {/* Plain text + caret, like the reference composer — no pill. */}
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size="sm"
        aria-label="Agent model"
        disabled={disabled()}
        class="h-8 max-w-[60vw] min-w-0 justify-start gap-1 rounded-lg border-none bg-transparent px-1.5 text-left text-sm text-ink-muted hover:bg-hover"
      >
        <TextShimmer
          text={label()}
          active={props.changingTo !== undefined}
          class="min-w-0 truncate"
        />
        <CaretDown class="size-3.5 shrink-0" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Choose a model">
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody>
            <For each={groups()}>
              {(group) => (
                <>
                  <Show when={group.label}>
                    {(heading) => (
                      <MobileDrawer.Label>{heading()}</MobileDrawer.Label>
                    )}
                  </Show>
                  <MobileDrawer.Section
                    role="radiogroup"
                    aria-label={group.label ?? 'Models'}
                    class="mb-3 flex shrink-0 flex-col"
                  >
                    <For each={group.options}>
                      {(option) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={option.id === shown()}
                          title={option.description ?? undefined}
                          class="flex w-full items-center gap-3 bg-surface px-4 py-3 text-left text-sm text-ink hover:bg-hover hover-transition-bg not-last:mb-px"
                          onClick={() => pick(option.id)}
                        >
                          <span class="min-w-0 flex-1 truncate">
                            {option.name}
                          </span>
                          <Show when={option.id === shown()}>
                            <Check class="size-3.5 shrink-0 text-accent" />
                          </Show>
                        </button>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </>
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );

  const shortList = (
    <Dropdown placement="top-start">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class={PILL_TRIGGER_CLASS}
        disabled={disabled()}
      >
        <TextShimmer text={label()} active={props.changingTo !== undefined} />
        <CaretDown />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="overflow-hidden"
        onEscapeKeyDown={() => {
          shortListDismissedWithEscape = true;
        }}
        onCloseAutoFocus={(event) => {
          if (!shortListDismissedWithEscape) return;
          shortListDismissedWithEscape = false;
          if (!props.onEscape) return;
          event.preventDefault();
          // Kobalte's dropdown wrapper focuses its trigger after this callback.
          queueMicrotask(props.onEscape);
        }}
      >
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
                    onSelect={() => pick(option.id)}
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
  );

  return (
    <Show when={props.options.length > 0}>
      <Show when={!isTouchDevice()} fallback={sheet}>
        <Show when={useCatalog()} fallback={shortList}>
          <ModelCatalogPicker
            value={shown()}
            options={catalogOptions()}
            onSelect={pick}
            onEscape={props.onEscape}
            disabled={disabled()}
            ariaLabel="Agent model"
            searchPlaceholder="Search models"
            triggerClass={PILL_TRIGGER_CLASS}
            contentClass="overflow-hidden"
            placement="top-start"
          />
        </Show>
      </Show>
    </Show>
  );
}
