import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { createPromotionVisibility } from '@app/features/sidebar-promotion/sidebar-promotion';
import { analytics } from '@app/lib/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { toast } from '@core/component/Toast/Toast';
import {
  enableRoutineCodeSteps,
  enableRoutineConditions,
} from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { fireAndForget } from '@core/util/fireAndForget';
import { useEnsureTagSetMutation } from '@queries/properties/tags';
import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';
import { Button, Tabs } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import type { RoutineTemplate } from '../routines/core/routine-templates';
import { useRoutineCatalog } from '../routines/queries/catalog';
import { composeRoutine } from '../routines/queries/compose-routine';
import {
  useEmailLabelNames,
  useRoutineTags,
} from '../routines/queries/step-sources';
import { useComposerContext } from '../routines/routine-ai-composer';
import { startRoutineDraft } from '../routines/routine-draft-start';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import { RoutineSurface as RaisedSurface } from '../routines/components/routine-editor';
import {
  surfaceLook,
  TemplateChain,
} from '../routines/components/routine-template-strip';
import { RoutineSuggestionsCard } from './components/routine-suggestions-card';
import { RoutineSuggestionsDialog } from './components/routine-suggestions-dialog';
import { SuggestionRow } from './components/suggestion-row';
import { suggestionSummary } from './core/suggestion-draft';
import {
  ROUTINE_SURFACES,
  type RoutineSurface,
  SURFACE_COPY,
} from './core/surfaces';
import {
  createSuggestionActions,
  type SuggestionActions,
} from './primitives/suggestion-actions';
import {
  refreshRoutineSuggestions,
  useDismissRoutineSuggestionMutation,
  useRoutineSuggestions,
  useRoutineSuggestionsEnabled,
} from './queries/routine-suggestions';

/** Production wiring for accepting and dismissing suggestions. */
function useProductionActions(onLeave: () => void): SuggestionActions {
  const layout = useSplitLayout();
  const hasPaidAccess = useHasPaidAccess();
  const defaultModel = () => defaultModelForPlan(hasPaidAccess());
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const decisions = useFeatureFlag(enableRoutineConditions);
  const catalog = useRoutineCatalog();
  const labels = useEmailLabelNames();
  const tags = useRoutineTags();
  const channels = useChannelsContext();
  const composer = useComposerContext({
    defaultModel,
    decisionsEnabled: () => decisions().enabled,
  });
  const ensureTagSet = useEnsureTagSetMutation();
  const dismiss = useDismissRoutineSuggestionMutation();
  return createSuggestionActions({
    catalog,
    defaultModel,
    codeSteps: () => codeSteps().enabled,
    workspace: () => ({
      label: labels(),
      tag: tags()
        .filter((tag) => tag.scope === 'user')
        .map((tag) => tag.label),
      channel: channels
        .channels()
        .flatMap((channel) => (channel.name ? [channel.name] : [])),
    }),
    async ensurePersonalTags() {
      await ensureTagSet.mutateAsync({ scope: 'user' });
    },
    draft: (request) => composeRoutine(request, composer()),
    review(draft) {
      onLeave();
      startRoutineDraft(draft);
      openAgentsPage(layout, 'routines', { routineId: 'new' });
    },
    describe(request) {
      onLeave();
      layout.popoverSplit({
        type: 'component',
        id: 'routine-compose',
        params: { initialDescription: request },
      });
    },
    dismiss(id) {
      dismiss.mutate(id, {
        onError: () =>
          toast.alert('Couldn’t dismiss that suggestion', {
            subtext: 'Try again.',
          }),
      });
    },
    notify: (message) => toast.alert(message),
  });
}

/** Suggestions with what each row shows, dropping those it can't show. */
function rows(
  suggestions: readonly RoutineSuggestion[],
  catalog: readonly RoutineTemplate[]
) {
  return suggestions.flatMap((suggestion) => {
    const entry =
      suggestion.kind === 'starter'
        ? catalog.find((routine) => routine.key === suggestion.key)
        : undefined;
    const summary = suggestionSummary(suggestion, entry);
    return summary ? [{ suggestion, summary }] : [];
  });
}

/**
 * The rows, with the production actions; built only while shown, since the
 * drafter's workspace context loads several lists.
 */
function SuggestionList(props: {
  suggestions: readonly RoutineSuggestion[];
  onLeave?: () => void;
  showSurface?: boolean;
}) {
  const catalog = useRoutineCatalog();
  const actions = useProductionActions(() => props.onLeave?.());
  return (
    <ul class="flex flex-col gap-1" aria-label="Suggested routines">
      <For each={rows(props.suggestions, catalog())}>
        {(row) => (
          <SuggestionRow
            summary={row.summary}
            surface={row.suggestion.surface}
            reason={row.suggestion.reason}
            drafted={row.suggestion.kind === 'request'}
            surfaceLabel={
              props.showSurface
                ? SURFACE_COPY[row.suggestion.surface].label
                : undefined
            }
            pending={actions.pending() === row.suggestion.id}
            busy={actions.pending() !== undefined}
            onReview={() =>
              fireAndForget(
                actions.review(row.suggestion),
                'routine-suggestions.review'
              )
            }
            onDismiss={() => actions.dismiss(row.suggestion)}
          />
        )}
      </For>
    </ul>
  );
}

/**
 * The suggested-routines card at the top of a view sidebar, which opens
 * that surface's suggestions. It shows only while there are some, and
 * closing it hides it on every device.
 */
export function SidebarRoutineSuggestions(props: {
  surface: RoutineSurface;
  class?: string;
}) {
  const enabled = useRoutineSuggestionsEnabled();
  return (
    <Show when={enabled()}>
      <SidebarCard surface={props.surface} class={props.class} />
    </Show>
  );
}

function SidebarCard(props: { surface: RoutineSurface; class?: string }) {
  const source = useRoutineSuggestions();
  const forSurface = createMemo(() =>
    source
      .suggestions()
      ?.filter((suggestion) => suggestion.surface === props.surface)
  );
  const visibility = createPromotionVisibility(
    () => `routine-suggestions:${props.surface}`,
    () => {
      const current = forSurface();
      return current === undefined ? undefined : current.length > 0;
    }
  );
  const layout = useSplitLayout();
  const [open, setOpen] = createSignal(false);
  const catalog = useRoutineCatalog();
  const teaser = () => {
    const [first] = rows(forSurface() ?? [], catalog());
    return first?.summary.title ?? SURFACE_COPY[props.surface].pitch;
  };
  return (
    <Show when={visibility.shown()}>
      <RoutineSuggestionsCard
        class={props.class}
        teaser={teaser()}
        more={Math.max(0, (forSurface()?.length ?? 0) - 1)}
        onOpen={() => {
          analytics.track('routine_suggestions_opened', {
            surface: props.surface,
            suggestions: forSurface()?.length ?? 0,
          });
          setOpen(true);
        }}
        onDismiss={() => {
          analytics.track('routine_suggestions_card_dismissed', {
            surface: props.surface,
          });
          visibility.dismiss();
        }}
      />
      <RoutineSuggestionsDialog
        open={open()}
        onOpenChange={setOpen}
        title={`Routines for ${SURFACE_COPY[props.surface].label}`}
        refreshing={source.generating()}
        onRefresh={() =>
          fireAndForget(refreshRoutineSuggestions(), 'routine-suggestions')
        }
        onSeeAll={() => {
          setOpen(false);
          openAgentsPage(layout, 'routines');
        }}
      >
        <SuggestionList
          suggestions={forSurface() ?? []}
          onLeave={() => setOpen(false)}
        />
      </RoutineSuggestionsDialog>
    </Show>
  );
}

/**
 * "Suggested for you" on the Routines page, in place of Macro's templates
 * while there are suggestions.
 */
export function RoutineSuggestionsSection(props: {
  /** Shown instead when there are no suggestions, e.g. the templates. */
  fallback: JSX.Element;
}) {
  const enabled = useRoutineSuggestionsEnabled();
  return (
    <Show when={enabled()} fallback={props.fallback}>
      <SuggestedForYou fallback={props.fallback} />
    </Show>
  );
}


/** Variant B: the top suggestions as raised cards in the template strip's look; a card opens Review. */
function SuggestionCards(props: { suggestions: readonly RoutineSuggestion[] }) {
  const catalog = useRoutineCatalog();
  const actions = useProductionActions(() => {});
  return (
    <div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5 @max-[760px]/routines:-mx-3 @max-[760px]/routines:auto-cols-[15rem] @max-[760px]/routines:grid-flow-col @max-[760px]/routines:grid-cols-none @max-[760px]/routines:overflow-x-auto @max-[760px]/routines:px-3 @max-[760px]/routines:pb-1">
      <For each={rows(props.suggestions, catalog())}>
        {(row) => {
          const look = () => surfaceLook(row.suggestion.surface);
          const entry = () =>
            row.suggestion.kind === 'starter'
              ? catalog().find((each) => each.key === (row.suggestion as { key: string }).key)
              : undefined;
          return (
            <RaisedSurface>
              <button
                type="button"
                aria-label={`Review ${row.summary.title}`}
                disabled={actions.pending() !== undefined}
                class="flex size-full min-w-0 flex-col items-start gap-1.5 rounded-xl px-4 py-3.5 text-left outline-none not-touch:hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
                onClick={() =>
                  fireAndForget(actions.review(row.suggestion), 'routine-suggestions.review')
                }
              >
                <Dynamic component={look().icon} class={cn('size-4 shrink-0', look().tint)} aria-hidden="true" />
                <span class="text-sm font-medium text-ink">
                  {actions.pending() === row.suggestion.id
                    ? row.suggestion.kind === 'request' ? 'Drafting…' : 'Opening…'
                    : row.summary.title}
                </span>
                <span class="line-clamp-1 text-xs leading-4 text-ink-muted">{row.summary.does}</span>
                <span class="mt-1 min-w-0 max-w-full">
                  <Show
                    when={entry()}
                    fallback={
                      <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                        <ArrowRightIcon class="size-2.5 shrink-0 text-ink-placeholder" aria-hidden="true" />
                        <SparkleIcon class="size-3 shrink-0 text-accent" aria-hidden="true" />
                        <span class="truncate">AI drafts it for you to review</span>
                      </span>
                    }
                  >
                    {(template) => <TemplateChain template={template()} />}
                  </Show>
                </span>
              </button>
            </RaisedSurface>
          );
        }}
      </For>
    </div>
  );
}

/** The Routines page shows this many until the person asks for more. */
const ROUTINES_PAGE_SHOWN = 3;

function SuggestedForYou(props: { fallback: JSX.Element }) {
  const source = useRoutineSuggestions();
  const [expanded, setExpanded] = createSignal(false);
  const [surface, setSurface] = createSignal<RoutineSurface | 'all'>('all');
  // Best first across areas: AI's estimate that the person keeps it.
  const ranked = createMemo(() =>
    (source.suggestions() ?? []).toSorted(
      (a, b) => b.keepProbability - a.keepProbability
    )
  );
  const filterOptions = createMemo(() => [
    { value: 'all' as const, label: 'All' },
    ...ROUTINE_SURFACES.filter((each) =>
      ranked().some((suggestion) => suggestion.surface === each)
    ).map((each) => ({ value: each, label: SURFACE_COPY[each].label })),
  ]);
  const visible = () => {
    if (!expanded()) return ranked().slice(0, ROUTINES_PAGE_SHOWN);
    const current = surface();
    return current === 'all'
      ? ranked()
      : ranked().filter((suggestion) => suggestion.surface === current);
  };
  const more = () => ranked().length - ROUTINES_PAGE_SHOWN;
  return (
    <Show when={ranked().length} fallback={props.fallback}>
      <section
        aria-labelledby="routine-suggestions-heading"
        class="flex min-w-0 flex-col gap-3 px-4 pt-4 pb-2 @max-[760px]/routines:px-3"
      >
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3 px-1">
          <div class="min-w-0">
            <h2
              id="routine-suggestions-heading"
              class="text-sm font-semibold text-ink"
            >
              Suggested for you
            </h2>
            <p class="text-xs text-ink-muted">
              Routines AI picked from your workspace. Review one to see and
              change it before it’s saved.
            </p>
          </div>
          <Show when={expanded() && filterOptions().length > 2}>
            <Tabs
              aria-label="Suggestion area"
              size="sm"
              wrap
              options={filterOptions()}
              value={surface()}
              onChange={setSurface}
            />
          </Show>
        </div>
        <Show
          when={expanded()}
          fallback={<SuggestionCards suggestions={visible()} />}
        >
          <SuggestionList
            suggestions={visible()}
            showSurface={surface() === 'all'}
          />
        </Show>
        <Show when={more() > 0}>
          <Button
            variant="ghost"
            size="sm"
            class="self-start"
            aria-expanded={expanded()}
            onClick={() => {
              setExpanded(!expanded());
              setSurface('all');
            }}
          >
            {expanded() ? 'Fewer suggestions' : `More suggestions (${more()})`}
          </Button>
        </Show>
      </section>
    </Show>
  );
}
