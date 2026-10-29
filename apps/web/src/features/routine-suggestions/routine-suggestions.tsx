import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { createPromotionVisibility } from '@app/features/sidebar-promotion/sidebar-promotion';
import { analytics } from '@app/lib/analytics';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { Tabs } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { draftToCreateBody } from '../routines/queries/routine-draft';
import {
  useCreateScheduleMutation,
  useSchedulesQuery,
} from '../routines/queries/schedules';
import { RoutineSuggestionsCard } from './components/routine-suggestions-card';
import { RoutineSuggestionsDialog } from './components/routine-suggestions-dialog';
import {
  type RoutineSurface,
  routineSurfaceCopy,
  routineSurfaces,
} from './core/surfaces';
import { createSuggestionActions } from './primitives/suggestion-actions';
import { createRoutineSuggestions } from './queries/routine-suggestions';
import {
  SuggestionRows,
  suggestionListView,
} from './views/suggestion-list-view';

/** Production wiring shared by the sidebar modal and the Routines page. */
function createProductionSuggestions(
  /** Whether the user's routines are needed yet (to mark ones they have). */
  listRoutines: () => boolean,
  onLeave: () => void
) {
  const layout = useSplitLayout();
  const userId = useUserId();
  const source = createRoutineSuggestions({
    ready: () => userId() !== undefined,
  });
  const hasPaidAccess = useHasPaidAccess();
  const routines = useSchedulesQuery(listRoutines);
  const create = useCreateScheduleMutation(undefined, 'suggestion');
  const actions = createSuggestionActions({
    target: () => ({
      kind: 'model',
      model: defaultModelForPlan(hasPaidAccess()),
    }),
    existingRoutines: () =>
      routines.isPending
        ? []
        : (routines.data ?? []).flatMap((routine) =>
            routine.id ? [{ id: routine.id, name: routine.name }] : []
          ),
    async create(draft) {
      const created = await create.mutateAsync(draftToCreateBody(draft));
      if (!created.id) throw new Error('Created routine has no ID');
      return created.id;
    },
    customize(draft) {
      onLeave();
      layout.popoverSplit({
        type: 'component',
        id: 'routine-compose',
        params: { initialDraft: draft },
      });
    },
  });
  return {
    source,
    actions,
    openRoutines: (routineId?: string) => {
      onLeave();
      openAgentsPage(
        layout,
        'routines',
        routineId === undefined ? {} : { routineId }
      );
    },
    refresh: () => fireAndForget(source.refresh(), 'routine-suggestions'),
  };
}

/**
 * The "Suggested routines" card at the top of a view sidebar, and the modal
 * it opens with AI-picked routines for that surface. The close button hides
 * the card on every device.
 */
export function SidebarRoutineSuggestions(props: {
  surface: RoutineSurface;
  class?: string;
}) {
  const visibility = createPromotionVisibility(
    () => `routine-suggestions:${props.surface}`,
    () => true
  );
  return (
    <Show when={visibility.shown()}>
      <SidebarRoutineSuggestionsCard
        surface={props.surface}
        class={props.class}
        onDismiss={() => {
          analytics.track('routine_suggestions_dismissed', {
            surface: props.surface,
          });
          visibility.dismiss();
        }}
      />
    </Show>
  );
}

function SidebarRoutineSuggestionsCard(props: {
  surface: RoutineSurface;
  class?: string;
  onDismiss(): void;
}) {
  const [open, setOpen] = createSignal(false);
  const suggestions = createProductionSuggestions(open, () => setOpen(false));
  const copy = () => routineSurfaceCopy[props.surface];
  const forSurface = createMemo(() =>
    suggestions.source
      .suggestions()
      ?.filter((suggestion) => suggestion.surface === props.surface)
  );
  const view = () =>
    suggestionListView({
      suggestions: forSurface(),
      generating: suggestions.source.generating(),
      failed: suggestions.source.error() !== undefined,
    });
  return (
    <>
      <RoutineSuggestionsCard
        class={props.class}
        teaser={forSurface()?.[0]?.title ?? copy().pitch}
        more={Math.max(0, (forSurface()?.length ?? 0) - 1)}
        onOpen={() => {
          analytics.track('routine_suggestions_opened', {
            surface: props.surface,
            suggestions: forSurface()?.length ?? 0,
          });
          setOpen(true);
        }}
        onDismiss={props.onDismiss}
      />
      <RoutineSuggestionsDialog
        open={open()}
        onOpenChange={setOpen}
        title={`Routines for ${copy().label}`}
        refreshing={suggestions.source.generating()}
        onRefresh={suggestions.refresh}
        onSeeAll={() => suggestions.openRoutines()}
      >
        <SuggestionRows
          view={view()}
          actions={suggestions.actions}
          emptyLabel={`No ${copy().label.toLowerCase()} routines to suggest yet. As your workspace grows, new ideas show up here.`}
          onRetry={suggestions.refresh}
          onOpenRoutine={suggestions.openRoutines}
        />
      </RoutineSuggestionsDialog>
    </>
  );
}

type SurfaceFilter = RoutineSurface | 'all';

/** "Suggested for you" below the routines list, across every surface. */
export function RoutineSuggestionsSection() {
  const suggestions = createProductionSuggestions(
    () => true,
    () => {}
  );
  const [filter, setFilter] = createSignal<SurfaceFilter>('all');
  const all = suggestions.source.suggestions;
  const filterOptions = createMemo(() => {
    const present = new Set(all()?.map((suggestion) => suggestion.surface));
    return [
      { value: 'all' as const, label: 'All' },
      ...routineSurfaces
        .filter((surface) => present.has(surface))
        .map((surface) => ({
          value: surface,
          label: routineSurfaceCopy[surface].label,
        })),
    ];
  });
  const visible = () => {
    const current = filter();
    return current === 'all'
      ? all()
      : all()?.filter((suggestion) => suggestion.surface === current);
  };
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
            Routines AI picked from your workspace. Enable one in a click, or
            open it to edit first.
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
        view={suggestionListView({
          suggestions: visible(),
          generating: suggestions.source.generating(),
          failed: suggestions.source.error() !== undefined,
        })}
        actions={suggestions.actions}
        showSurface={filter() === 'all'}
        emptyLabel="No routines to suggest yet. As your workspace grows, new ideas show up here."
        onRetry={suggestions.refresh}
        onOpenRoutine={suggestions.openRoutines}
      />
    </section>
  );
}
