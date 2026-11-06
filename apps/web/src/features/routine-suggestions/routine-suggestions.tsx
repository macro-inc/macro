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
    <ul class="flex flex-col">
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

function SuggestedForYou(props: { fallback: JSX.Element }) {
  const source = useRoutineSuggestions();
  const [surface, setSurface] = createSignal<RoutineSurface | 'all'>('all');
  const present = createMemo(() =>
    ROUTINE_SURFACES.filter((each) =>
      source.suggestions()?.some((suggestion) => suggestion.surface === each)
    )
  );
  const visible = () =>
    source
      .suggestions()
      ?.filter(
        (suggestion) => surface() === 'all' || suggestion.surface === surface()
      ) ?? [];
  return (
    <Show when={source.suggestions()?.length} fallback={props.fallback}>
      <section
        aria-label="Suggested for you"
        class="grid min-w-0 gap-2 px-4 pb-2 pt-4 @max-[760px]/routines:px-3"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <h2 class="text-sm font-semibold text-ink">Suggested for you</h2>
          <span class="text-xs text-ink-muted">
            Picked by AI from your workspace. Review one before it’s saved.
          </span>
          <Show when={present().length > 1}>
            <div
              class="ml-auto flex flex-wrap gap-1"
              role="group"
              aria-label="Suggestion area"
            >
              <For each={['all' as const, ...present()]}>
                {(each) => (
                  <button
                    type="button"
                    aria-pressed={surface() === each}
                    class="rounded-full px-2 py-0.5 text-xs text-ink-muted aria-pressed:bg-hover aria-pressed:text-ink"
                    onClick={() => setSurface(each)}
                  >
                    {each === 'all' ? 'All' : SURFACE_COPY[each].label}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <SuggestionList
          suggestions={visible()}
          showSurface={surface() === 'all'}
        />
      </section>
    </Show>
  );
}
