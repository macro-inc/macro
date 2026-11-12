import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { withKnobValue } from '../../routines/core/knobs';
import {
  RoutineSuggestionList,
  type SuggestionListView,
} from '../components/routine-suggestion-list';
import {
  type SuggestionCardModel,
  SuggestionDialogCard,
  SuggestionDiscoverCard,
  SuggestionMoreCell,
} from '../components/suggestion-card';
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

/** The sidebar dialog's cards, two to a row, with their states around them. */
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
                <SuggestionDialogCard
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

/** Discover's cards, four to a row. */
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
          count={8}
          class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5"
        />
      }
    >
      {(items) => (
        <CardGrid>
          <For each={items()}>
            {(item, index) => {
              const handlers = cardHandlers(
                item,
                props.actions,
                idsBefore(items, index),
                props.onOpenRoutine
              );
              return (
                <SuggestionDiscoverCard
                  model={cardModel(item, props.actions)}
                  {...handlers}
                />
              );
            }}
          </For>
        </CardGrid>
      )}
    </RoutineSuggestionList>
  );
}

/** Cards as Discover lays them out: as many columns of at least 15rem as fit. */
function CardGrid(props: {
  ref?: (element: HTMLUListElement) => void;
  children: JSX.Element;
}) {
  return (
    <ul
      ref={props.ref}
      class="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5"
      aria-label={t('routineSuggestions.listLabel')}
    >
      {props.children}
    </ul>
  );
}

/** Columns a row starts with, until it is measured. */
const ROW_COLUMNS = 4;

/**
 * The one row above the routines list: Discover's cards, at Discover's
 * size, as many as fit in one row with how many more Discover has in the
 * last column. Nothing while loading, failed or empty, so the list never
 * waits on it.
 */
export function SuggestionRow(props: {
  items: SuggestionItem[];
  actions: SuggestionActions;
  onOpenDiscover(): void;
  onOpenRoutine(routineId: string): void;
}): JSX.Element {
  const [columns, setColumns] = createSignal(ROW_COLUMNS);
  let grid: HTMLUListElement | undefined;
  // The grid decides how many columns fit; the row fills one row of them.
  createResizeObserver(
    () => grid,
    () => {
      if (!grid) return;
      const count = getComputedStyle(grid)
        .gridTemplateColumns.split(' ')
        .filter(Boolean).length;
      if (count > 0) setColumns(count);
    }
  );
  const fits = () => props.items.length <= columns();
  const visible = () =>
    fits() ? props.items : props.items.slice(0, columns() - 1);
  const more = () => props.items.length - visible().length;
  return (
    <section
      aria-labelledby="routine-suggestions-row-heading"
      class="flex min-w-0 flex-col gap-2.5 px-4 pt-3.5 pb-1.5"
    >
      <div class="flex h-[22px] min-w-0 items-center gap-2 px-0.5">
        <SparkleIcon class="size-3 text-violet-ink" aria-hidden="true" />
        <h2
          id="routine-suggestions-row-heading"
          class="text-[13px] font-medium text-ink-muted"
        >
          {t('routineSuggestions.suggestedForYou')}
        </h2>
      </div>
      <CardGrid ref={(element) => (grid = element)}>
        <For each={visible()}>
          {(item, index) => {
            const handlers = cardHandlers(
              item,
              props.actions,
              idsBefore(visible, index),
              props.onOpenRoutine
            );
            return (
              <SuggestionDiscoverCard
                model={cardModel(item, props.actions)}
                {...handlers}
              />
            );
          }}
        </For>
        <Show when={more() > 0}>
          <SuggestionMoreCell count={more()} onOpen={props.onOpenDiscover} />
        </Show>
      </CardGrid>
    </section>
  );
}
