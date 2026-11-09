import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { createPromotionVisibility } from '@app/features/sidebar-promotion/sidebar-promotion';
import { analytics } from '@app/lib/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  beginInteraction,
  TraceFlow,
  usePending,
} from '@app/observability/flow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { toast } from '@core/component/Toast/Toast';
import { enableRoutineCodeSteps } from '@core/constant/featureFlags';
import { useEnsureTagSetMutation } from '@queries/properties/tags';
import { Tabs } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { newRoutineDraft } from '../routines/core/routine-templates';
import { useRoutineCatalog } from '../routines/queries/catalog';
import { draftToCreateBody } from '../routines/queries/routine-draft';
import { useCreateScheduleMutation } from '../routines/queries/schedules';
import { startRoutineDraft } from '../routines/routine-draft-start';
import { RoutineSuggestionsCard } from './components/routine-suggestions-card';
import { RoutineSuggestionsDialog } from './components/routine-suggestions-dialog';
import {
  type SuggestionItem,
  suggestionItem,
  suggestionsFor,
  suggestionTitle,
} from './core/suggestions';
import {
  ROUTINE_SURFACES,
  type RoutineSurface,
  SURFACE_COPY,
} from './core/surfaces';
import {
  createSuggestionActions,
  type SuggestionPlacement,
} from './primitives/suggestion-actions';
import {
  useDismissRoutineSuggestionMutation,
  useRoutineSuggestions,
  useRoutineSuggestionsEnabled,
} from './queries/routine-suggestions';
import {
  SuggestionRows,
  suggestionListView,
} from './views/suggestion-list-view';

/**
 * Suggestions as rows, with the routine each saves, and the actions that
 * enable, edit and dismiss them. Built only where a list is on screen.
 */
function useSuggestionList(
  placement: () => SuggestionPlacement,
  onLeave: () => void
) {
  const layout = useSplitLayout();
  const source = useRoutineSuggestions();
  const catalog = useRoutineCatalog();
  const hasPaidAccess = useHasPaidAccess();
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const create = useCreateScheduleMutation();
  const ensureTagSet = useEnsureTagSetMutation();
  const dismiss = useDismissRoutineSuggestionMutation();

  const items = createMemo(() => {
    const suggestions = source.suggestions();
    if (!suggestions) return undefined;
    const model = defaultModelForPlan(hasPaidAccess());
    const context = {
      target: { kind: 'model' as const, model },
      codeSteps: codeSteps().enabled,
      base: newRoutineDraft(undefined, {
        defaultModel: model,
        codeSteps: codeSteps().enabled,
      }),
    };
    return suggestions.flatMap((suggestion) => {
      const item = suggestionItem(suggestion, catalog(), context);
      return item ? [item] : [];
    });
  });

  const actions = createSuggestionActions({
    placement,
    async create(draft, item) {
      // A tagging routine adds the person's own tags, which must exist.
      if (item.needsPersonalTags)
        await ensureTagSet.mutateAsync({ scope: 'user' });
      const created = await create.mutateAsync({
        body: draftToCreateBody(draft),
        suggestionId: item.id,
      });
      if (!created.id) throw new Error('Created routine has no ID');
      return created.id;
    },
    customize(draft) {
      onLeave();
      startRoutineDraft(draft);
      openAgentsPage(layout, 'routines', { routineId: 'new' });
    },
    async dismiss(item) {
      await dismiss.mutateAsync(item.id);
    },
    notify: (message) => toast.alert(message),
  });

  return {
    source,
    items,
    actions,
    openRoutine(routineId?: string) {
      onLeave();
      openAgentsPage(
        layout,
        'routines',
        routineId === undefined ? {} : { routineId }
      );
    },
  };
}

/** The sidebar dialog's list, for one surface. */
function SurfaceSuggestions(props: {
  surface: RoutineSurface;
  onLeave(): void;
}) {
  const list = useSuggestionList(
    () => ({ kind: 'sidebar', surface: props.surface }),
    () => props.onLeave()
  );
  const visible = createMemo(() => {
    const items = suggestionsFor(list.items(), props.surface);
    return items && list.actions.visible(items);
  });
  const view = () =>
    suggestionListView({
      suggestions: visible(),
      generating: list.source.generating(),
      failed: list.source.failed(),
    });
  usePending('routine_suggestions.load', () => view().kind === 'loading');
  return (
    <SuggestionRows
      view={view()}
      actions={list.actions}
      emptyLabel={`No ${SURFACE_COPY[props.surface].label.toLowerCase()} routines to suggest yet. As your workspace grows, new ideas show up here.`}
      onRetry={list.source.retry}
      onOpenRoutine={list.openRoutine}
    />
  );
}

/**
 * The "Suggested routines" card at the top of a view sidebar, which opens
 * that surface's suggestions. It shows only while there are some, and its
 * close button hides it on every device.
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
  const layout = useSplitLayout();
  const source = useRoutineSuggestions();
  const catalog = useRoutineCatalog();
  const forSurface = createMemo(() =>
    suggestionsFor(source.suggestions(), props.surface)
  );
  const visibility = createPromotionVisibility(
    () => `routine-suggestions:${props.surface}`,
    () => {
      const current = forSurface();
      return current === undefined ? undefined : current.length > 0;
    }
  );
  const [open, setOpen] = createSignal(false);
  const teaser = () => {
    const [first] = forSurface() ?? [];
    return (
      (first && suggestionTitle(first, catalog())) ??
      SURFACE_COPY[props.surface].pitch
    );
  };
  const openDialog = () => {
    analytics.track('routine_suggestions_opened', {
      surface: props.surface,
      suggestions: forSurface()?.length ?? 0,
    });
    // The dialog's list flow joins this, so one trace runs to its rows.
    const interaction = beginInteraction('routine_suggestions.open', {
      attributes: { 'routine.suggestion.surface': props.surface },
      closeOnJoin: true,
    });
    try {
      setOpen(true);
    } finally {
      interaction.end();
    }
  };
  return (
    <Show when={visibility.shown()}>
      <RoutineSuggestionsCard
        class={props.class}
        teaser={teaser()}
        more={Math.max(0, (forSurface()?.length ?? 0) - 1)}
        onOpen={openDialog}
        onDismiss={() => {
          analytics.track('routine_suggestions_card_dismissed', {
            surface: props.surface,
          });
          setOpen(false);
          visibility.dismiss();
        }}
      />
      <RoutineSuggestionsDialog
        open={open()}
        onOpenChange={setOpen}
        title={`Routines for ${SURFACE_COPY[props.surface].label}`}
        generating={source.generating()}
        onSeeAll={() => {
          setOpen(false);
          openAgentsPage(layout, 'routines');
        }}
      >
        <TraceFlow
          name="routine_suggestions.list"
          attributes={{
            'routine.suggestion.placement': 'sidebar',
            'routine.suggestion.surface': props.surface,
          }}
        >
          <SurfaceSuggestions
            surface={props.surface}
            onLeave={() => setOpen(false)}
          />
        </TraceFlow>
      </RoutineSuggestionsDialog>
    </Show>
  );
}

type SurfaceFilter = RoutineSurface | 'all';

/** "Suggested for you" below the routines list, filtered by surface. */
export function RoutineSuggestionsSection() {
  const enabled = useRoutineSuggestionsEnabled();
  return (
    <Show when={enabled()}>
      <TraceFlow
        name="routine_suggestions.list"
        attributes={{ 'routine.suggestion.placement': 'routines' }}
      >
        <SuggestedForYou />
      </TraceFlow>
    </Show>
  );
}

function SuggestedForYou() {
  const list = useSuggestionList(
    () => ({ kind: 'routines' }),
    () => {}
  );
  const [filter, setFilter] = createSignal<SurfaceFilter>('all');
  const all = createMemo(() => {
    const items = list.items();
    return items && list.actions.visible(items);
  });
  const filterOptions = createMemo(() => {
    const present = new Set(all()?.flatMap((item) => item.surfaces));
    return [
      { value: 'all' as const, label: 'All' },
      ...ROUTINE_SURFACES.filter((surface) => present.has(surface)).map(
        (surface) => ({ value: surface, label: SURFACE_COPY[surface].label })
      ),
    ];
  });
  const visible = (): SuggestionItem[] | undefined => {
    const current = filter();
    return current === 'all' ? all() : suggestionsFor(all(), current);
  };
  const view = () =>
    suggestionListView({
      suggestions: visible(),
      generating: list.source.generating(),
      failed: list.source.failed(),
    });
  usePending('routine_suggestions.load', () => view().kind === 'loading');
  return (
    <section
      aria-labelledby="routine-suggestions-heading"
      class="flex flex-col gap-3 border-t border-edge-muted px-4 pt-6 pb-8"
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
            Routines picked for your workspace, and templates from Macro. Enable
            one in a click, or open it to edit first.
          </p>
        </div>
        <Show when={filterOptions().length > 2}>
          <Tabs
            aria-label="Suggestion area"
            size="sm"
            wrap
            options={filterOptions()}
            value={filter()}
            onChange={setFilter}
          />
        </Show>
      </div>
      <SuggestionRows
        view={view()}
        actions={list.actions}
        showSurface={filter() === 'all'}
        emptyLabel="No routines to suggest yet. As your workspace grows, new ideas show up here."
        onRetry={list.source.retry}
        onOpenRoutine={list.openRoutine}
      />
    </section>
  );
}
