import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import {
  RoutineCardGrid,
  RoutineSectionHeader,
} from '../../routines/components/routine-cards';
import { withKnobValue } from '../../routines/core/knobs';
import {
  RoutineSuggestionList,
  type SuggestionListView,
} from '../components/routine-suggestion-list';
import {
  SuggestionCard,
  type SuggestionCardModel,
} from '../components/suggestion-card';
import {
  SuggestionCompactCard,
  type TurnedOnRoutine,
} from '../components/suggestion-compact-card';
import {
  type SuggestionItem,
  suggestionAction,
  suggestionLook,
  suggestionSentence,
} from '../core/suggestions';
import type { RoutineSurface } from '../core/surfaces';
import type { SuggestionActions } from '../primitives/suggestion-actions';

/** The list state; suggestions on screen stay through refetches. */
export function suggestionListView(input: {
  suggestions: SuggestionItem[] | undefined;
  generating: boolean;
  failed: boolean;
}): SuggestionListView {
  if (input.suggestions?.length) {
    return { kind: 'items', items: input.suggestions };
  }
  if (input.failed) return { kind: 'error' };
  if (input.suggestions === undefined || input.generating) {
    return { kind: 'loading' };
  }
  return { kind: 'empty' };
}

/** A suggestion as its card shows it, with what the person did to it here. */
function cardModel(
  item: SuggestionItem,
  actions: SuggestionActions,
  sidebar?: RoutineSurface
): SuggestionCardModel {
  return {
    title: item.title,
    look: suggestionLook(item, sidebar),
    surface: item.surfaces[0] ?? 'agents',
    chain: item.chain,
    sentence: suggestionSentence(item, actions.editsFor(item)),
    summary: item.summary,
    action: suggestionAction(item),
    status: actions.statusFor(item),
    picked: item.from === 'for_you',
    drafted: item.kind === 'routine',
    template: item.template,
    ...(item.reason ? { reason: item.reason } : {}),
  };
}

/**
 * One card's wiring: it counts as shown once on screen; the card opens the
 * routine in the editor, or once on, the routine; Turn on saves it in place
 * with the values on the card. Call it once per card, as the card renders.
 */
function cardHandlers(
  item: SuggestionItem,
  actions: SuggestionActions,
  above: () => string[],
  onOpenRoutine: (routineId: string) => void
) {
  onMount(() => actions.shown(item));
  return {
    onOpen() {
      const status = actions.statusFor(item);
      if (status.kind === 'enabled') {
        onOpenRoutine(status.routineId);
        return;
      }
      actions.customize(item);
    },
    onTurnOn() {
      fireAndForget(
        actions.enable(item, above()),
        'routine-suggestions.enable'
      );
    },
    onKnob(name: string, value: Parameters<typeof withKnobValue>[2]) {
      const sentence = suggestionSentence(item, actions.editsFor(item));
      if (!sentence) return;
      actions.editKnobs(item, withKnobValue(sentence.knobs, name, value));
    },
  };
}

/** The ids of the cards before `index`, top first. */
function idsBefore(items: () => SuggestionItem[], index: () => number) {
  return () =>
    items()
      .slice(0, index())
      .map((item) => item.id);
}

function SkeletonCards(props: { count: number; class: string }) {
  return (
    <ListSkeleton.Root
      label={t('routineSuggestions.loadingLabel')}
      class={props.class}
    >
      <For each={Array.from({ length: props.count })}>
        {() => (
          <div class="flex flex-col gap-2 rounded-xl border border-edge-muted p-4">
            <ListSkeleton.Bar class="h-3 w-2/5" />
            <ListSkeleton.Bar class="w-4/5" />
            <ListSkeleton.Bar class="w-1/3" />
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/**
 * The sidebar dialog's cards, two to a row, with their states around them.
 * In the 860px dialog each is 25rem wide: the width every suggestion card
 * has, on Discover and in the row above the routines list too.
 */
export function SuggestionDialogGrid(props: {
  view: SuggestionListView;
  actions: SuggestionActions;
  surface: RoutineSurface;
  emptyLabel: string;
  onRetry(): void;
  onOpenRoutine(routineId: string): void;
}) {
  return (
    <RoutineSuggestionList
      view={props.view}
      emptyLabel={props.emptyLabel}
      onRetry={props.onRetry}
      skeleton={<SkeletonCards count={4} class="grid grid-cols-2 gap-3" />}
    >
      {(items) => (
        <ul
          class="grid grid-cols-2 gap-3"
          aria-label={t('routineSuggestions.listLabel')}
        >
          <For each={items()}>
            {(item, index) => {
              const handlers = cardHandlers(
                item,
                props.actions,
                idsBefore(items, index),
                props.onOpenRoutine
              );
              return (
                <SuggestionCard
                  on="dialog"
                  model={cardModel(item, props.actions, props.surface)}
                  {...handlers}
                  onDismiss={
                    item.template
                      ? undefined
                      : () =>
                          fireAndForget(
                            props.actions.dismiss(item),
                            'routine-suggestions.dismiss'
                          )
                  }
                />
              );
            }}
          </For>
        </ul>
      )}
    </RoutineSuggestionList>
  );
}

/**
 * Discover's cards, as many to a row as fit, each the dialog's card width
 * (25rem), narrower only where the page can't fit one.
 */
export function SuggestionDiscoverGrid(props: {
  view: SuggestionListView;
  actions: SuggestionActions;
  emptyLabel: string;
  onRetry(): void;
  onOpenRoutine(routineId: string): void;
}) {
  return (
    <RoutineSuggestionList
      view={props.view}
      emptyLabel={props.emptyLabel}
      onRetry={props.onRetry}
      skeleton={
        <SkeletonCards
          count={6}
          class="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(0,25rem))] gap-3"
        />
      }
    >
      {(items) => (
        <ul
          class="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(0,25rem))] gap-3"
          aria-label={t('routineSuggestions.listLabel')}
        >
          <For each={items()}>
            {(item, index) => {
              const handlers = cardHandlers(
                item,
                props.actions,
                idsBefore(items, index),
                props.onOpenRoutine
              );
              return (
                <SuggestionCard
                  on="page"
                  model={cardModel(item, props.actions)}
                  {...handlers}
                />
              );
            }}
          </For>
        </ul>
      )}
    </RoutineSuggestionList>
  );
}
/**
 * Card columns a row starts with, until it is measured before the first
 * paint. One, so no card mounts (and counts as shown) only to be dropped.
 */
const ROW_CARD_COLUMNS = 1;

/** The routines list's side of the suggestions row. */
export type SuggestedRoutinesHost = {
  /** The person has no routines yet, so these are where to start. */
  empty: boolean;
  /** A routine a card turned on, as the routines list has it. */
  routine(routineId: string): TurnedOnRoutine | undefined;
  /** Switch a routine a card turned on. */
  onToggle(routineId: string): void;
};

/**
 * The row above the routines on the Routines page: one row of Discover's
 * cards in the page's grid, as many as it has columns, and how many more
 * Discover has at the end of its heading. Nothing while loading, failed or
 * empty, so the routines never wait on it.
 */
export function SuggestionRow(
  props: SuggestedRoutinesHost & {
    items: SuggestionItem[];
    actions: SuggestionActions;
    onOpenDiscover(): void;
    onOpenRoutine(routineId: string): void;
  }
): JSX.Element {
  const [columns, setColumns] = createSignal(ROW_CARD_COLUMNS);
  let grid: HTMLUListElement | undefined;
  // The grid's columns follow the page's width. A grid that isn't laid out
  // (a hidden ancestor) reports its template unexpanded, which counts nothing.
  createResizeObserver(
    () => grid,
    () => {
      if (!grid) return;
      const template = getComputedStyle(grid).gridTemplateColumns;
      if (template.includes('repeat(')) return;
      const count = template.split(' ').filter(Boolean).length;
      if (count > 0) setColumns(count);
    }
  );
  const visible = () => props.items.slice(0, columns());
  const more = () => props.items.length - visible().length;
  return (
    <section
      aria-labelledby="routine-suggestions-row-heading"
      class="flex min-w-0 flex-col gap-3.5"
    >
      <RoutineSectionHeader
        id="routine-suggestions-row-heading"
        icon={SparkleIcon}
        title={
          props.empty
            ? t('routinesList.startWithOne')
            : t('routineSuggestions.suggestedForYou')
        }
        end={
          <Show when={more() > 0}>
            <button
              type="button"
              class="flex shrink-0 items-center gap-1 rounded-md text-[13px] font-medium leading-5 text-ink-muted outline-none not-touch:hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
              onClick={() => props.onOpenDiscover()}
            >
              {t('routineSuggestions.moreInDiscover', { count: more() })}
              <ArrowRightIcon class="size-3.5" aria-hidden="true" />
            </button>
          </Show>
        }
      />
      <RoutineCardGrid
        ref={(element) => (grid = element)}
        aria-label={t('routineSuggestions.listLabel')}
      >
        <For each={visible()}>
          {(item, index) => {
            const handlers = cardHandlers(
              item,
              props.actions,
              idsBefore(visible, index),
              props.onOpenRoutine
            );
            const routineId = () => {
              const status = props.actions.statusFor(item);
              return status.kind === 'enabled' ? status.routineId : undefined;
            };
            const routine = () => {
              const id = routineId();
              return id ? props.routine(id) : undefined;
            };
            return (
              <SuggestionCompactCard
                model={cardModel(item, props.actions)}
                onOpen={handlers.onOpen}
                onTurnOn={handlers.onTurnOn}
                onDismiss={
                  item.template
                    ? undefined
                    : () =>
                        fireAndForget(
                          props.actions.dismiss(item),
                          'routine-suggestions.dismiss'
                        )
                }
                routine={routine()}
                onToggle={() => {
                  const id = routineId();
                  if (id) props.onToggle(id);
                }}
              />
            );
          }}
        </For>
      </RoutineCardGrid>
    </section>
  );
}
