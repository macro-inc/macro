/**
 * The session's model, as a pill that opens the harness's own model list.
 *
 * The catalog is harness-reported: the options come from the runtime's ACP
 * `configOptions` and the current model is the fold's rejection-safe
 * projection of them. Names and logos still go through the house
 * `modelLabel` / `ModelIcon`, because a runtime that keeps no display name
 * for a model — the in-memory Macro Agent among them — reports the slug as
 * its name. Renders nothing until the harness has advertised its models.
 *
 * Touch devices get a bottom sheet (`MobileDrawer`, the same chrome as the
 * split title menu) listing every model with a check on the current one, and
 * a compact searchable catalog with Suggested and More models. Desktop keeps
 * a popover: a compact scrolling list for short catalogs, the searchable
 * `ModelCatalogPicker` for long ones.
 *
 * Harnesses advertise as many models as they like, so the desktop list
 * scrolls rather than growing without bound: it shows at most
 * `MAX_VISIBLE_ROWS` (or fewer, when the popper has less room than that),
 * leaving the next row half-cut under a gradient so the overflow is visible
 * rather than merely scrollable.
 */

import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  ModelCatalogPicker,
  type ModelRowProps,
} from '@core/component/AI/component/input/ModelCatalogPicker';
import {
  buildModelCatalog,
  type CatalogModelOption,
  isLargeModelCatalog,
  matchesModelQuery,
} from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import type { ModelOption } from '@service-agent-fold/generated/types';
import { Button, cn, Dropdown } from '@ui';
import { type Component, createMemo, createSignal, For, Show } from 'solid-js';
import { withoutRedundantGroups } from './model-groups';

/** Compact ghost pill — same size as the short-list trigger and chat's selector. */
const PILL_TRIGGER_CLASS =
  'h-6 w-auto max-w-[9rem] min-w-0 justify-start gap-1 rounded-full border-transparent bg-ink/5 px-2 text-left text-sm text-ink-subtle hover:bg-ink/10';

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
   * A change to this model the fold has shown but `metadata.model` has not
   * caught up to. The pill reads it as the current model at once and stays
   * interactive; a runtime rejection later reverts it through the fold.
   */
  changingTo?: string;
  /** The models the harness offers, in the order it listed them. */
  options: ModelOption[];
  disabled?: boolean;
  effortLabel?: string;
  modelRow?: Component<ModelRowProps>;
  /** Receives the id of the model to switch to. */
  onSelect: (model: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function AgentModelSelector(props: AgentModelSelectorProps) {
  const [listRef, setListRef] = createSignal<HTMLElement>();
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;
  const shown = () => props.changingTo ?? props.model;
  const baseLabel = () =>
    modelLabel(
      shown() ?? undefined,
      props.options.find((option) => option.id === shown())?.name
    );
  const label = () =>
    isTouchDevice()
      ? [baseLabel(), props.effortLabel].filter(Boolean).join(' · ')
      : baseLabel();
  const options = createMemo(() => withoutRedundantGroups(props.options));
  const toCatalogOption = (option: ModelOption): CatalogModelOption => ({
    id: option.id,
    label: modelLabel(option.id, option.name),
    description: option.description ?? undefined,
    group: option.group ?? undefined,
  });
  const catalogOptions = () => options().map(toCatalogOption);
  const useCatalog = () => isLargeModelCatalog(catalogOptions());
  const catalog = createMemo(() => buildModelCatalog(catalogOptions(), true));
  const groups = createMemo(() => {
    const queryText = query().trim().toLowerCase();
    const sections =
      showAll() || queryText || catalog().frontier.length === 0
        ? catalog().providers
        : [{ label: 'Suggested', options: catalog().frontier }];
    return sections
      .map((section) => ({
        ...section,
        options: section.options.filter((option) =>
          matchesModelQuery(option, queryText)
        ),
      }))
      .filter((section) => section.options.length > 0);
  });
  const openSheet = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setQuery('');
      setShowAll(false);
    }
  };

  const pick = (id: string) => {
    openSheet(false);
    if (id !== props.model) props.onSelect(id);
  };

  const sheet = (
    <MobileDrawer
      side="bottom"
      open={sheetOpen()}
      onOpenChange={openSheet}
      restoreFocus={!!props.onCloseAutoFocus}
      onFinalFocus={props.onCloseAutoFocus}
      onInitialFocus={(event) => {
        event.preventDefault();
        searchInput?.focus();
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      {/* Provider logo + text + caret, like the reference composer — no pill. */}
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size="sm"
        aria-label="Agent model"
        disabled={props.disabled || props.changingTo !== undefined}
        onPointerDown={(event: PointerEvent) => event.preventDefault()}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
        class="h-8 max-w-[60vw] min-w-0 justify-start gap-1.5 rounded-lg border-none bg-transparent px-1.5 text-left text-sm text-ink-subtle hover:bg-hover"
      >
        <ModelIcon model={shown()} />
        <span class="min-w-0 truncate">{label()}</span>
        <CaretDown class="size-3.5 shrink-0" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Choose a model">
          <MobileDrawer.Handle />
          <div class="flex items-center gap-2 px-4 pb-3">
            <Show when={showAll()}>
              <Button
                variant="ghost"
                size="icon-md"
                label="Back to Suggested"
                onClick={() => {
                  setShowAll(false);
                  setQuery('');
                  searchInput?.focus();
                }}
              >
                <ArrowLeft />
              </Button>
            </Show>
            <MobileDrawer.Title class="min-w-0 flex-1 truncate font-medium">
              {showAll() ? 'All models' : 'Choose a model'}
            </MobileDrawer.Title>
          </div>
          <div class="mx-4 mb-2 flex h-9 shrink-0 items-center gap-2 px-3">
            <SearchIcon class="size-4 shrink-0 text-ink-extra-muted" />
            <input
              ref={searchInput}
              type="text"
              aria-label="Search models"
              placeholder="Search models"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              class="h-full min-w-0 w-full border-0 bg-transparent p-0 text-base outline-none placeholder:text-ink-extra-muted"
            />
          </div>
          <MobileDrawer.ScrollBody class="gap-1">
            <Show when={groups().length === 0}>
              <div role="status" class="px-4 py-3 text-sm text-ink-muted">
                {props.options.length === 0
                  ? 'Waiting for the agent to report its models.'
                  : 'No models match that search.'}
              </div>
            </Show>
            <For each={groups()}>
              {(group) => (
                <>
                  <Show when={group.label}>
                    {(heading) => (
                      <MobileDrawer.Label class="px-4 pb-1 font-medium text-ink-muted">
                        {heading()}
                      </MobileDrawer.Label>
                    )}
                  </Show>
                  <MobileDrawer.Section
                    role="radiogroup"
                    aria-label={group.label ?? 'Models'}
                    class="rounded-none bg-transparent p-0"
                  >
                    <For each={group.options}>
                      {(option) => (
                        <MobileDrawer.Item
                          type="button"
                          role="radio"
                          aria-checked={option.id === shown()}
                          title={option.description ?? undefined}
                          onClick={() => pick(option.id)}
                        >
                          <ModelIcon model={option.id} />
                          <span class="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                          <Show when={option.id === shown()}>
                            <Check class="size-3.5 shrink-0 text-accent" />
                          </Show>
                        </MobileDrawer.Item>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </>
              )}
            </For>
            <Show
              when={
                !showAll() && !query().trim() && catalog().frontier.length > 0
              }
            >
              <MobileDrawer.Section class="rounded-none bg-transparent p-0">
                <MobileDrawer.Item
                  onClick={() => {
                    setShowAll(true);
                    searchInput?.focus();
                  }}
                >
                  <SquaresFour class="size-4 shrink-0 text-ink-muted" />
                  <span class="flex-1">More models</span>
                  <CaretRight class="size-4" />
                </MobileDrawer.Item>
              </MobileDrawer.Section>
            </Show>
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
        disabled={props.disabled}
      >
        <ModelIcon model={shown()} class="size-3.5" />
        <span class="min-w-0 truncate">{label()}</span>
        <CaretDown class="shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-60 max-w-[calc(100vw-1rem)] overflow-hidden">
        {/* The gradients anchor here, outside the scrolling box, and read
            the menu background through `--color-surface`. */}
        <div class="relative [--color-surface:var(--color-menu)]">
          <Dropdown.Group
            ref={setListRef}
            class="overflow-y-auto overscroll-contain p-0"
            style={{ 'max-height': LIST_MAX_HEIGHT }}
          >
            <div class="flex flex-col p-1.5">
              <For each={options()}>
                {(option) => (
                  <Dropdown.Item
                    class={cn(
                      'h-7 shrink-0 gap-2',
                      option.id === shown() && 'text-ink font-medium'
                    )}
                    title={option.description ?? undefined}
                    onSelect={() => pick(option.id)}
                  >
                    <ModelIcon model={option.id} class="size-3.5" />
                    <span class="flex-1 truncate">
                      {modelLabel(option.id, option.name)}
                    </span>
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
    <Show when={isTouchDevice() || props.options.length > 0}>
      <Show when={!isTouchDevice()} fallback={sheet}>
        <Show when={useCatalog() || props.modelRow} fallback={shortList}>
          <ModelCatalogPicker
            value={shown()}
            options={catalogOptions()}
            onSelect={pick}
            modelRow={props.modelRow}
            triggerLabel={label()}
            disabled={props.disabled}
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
