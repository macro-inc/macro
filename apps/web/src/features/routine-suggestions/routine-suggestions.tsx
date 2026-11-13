import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { createPromotionVisibility } from '@app/features/sidebar-promotion/sidebar-promotion';
import { analytics } from '@app/lib/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import {
  beginInteraction,
  TraceFlow,
  usePending,
} from '@app/observability/flow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { toast } from '@core/component/Toast/Toast';
import {
  enableRoutineCodeSteps,
  enableRoutineConditions,
  enableRoutineStarterTemplates,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { useEnsureTagSetMutation } from '@queries/properties/tags';
import type {
  RoutineSuggestion,
  SuggestionFrom,
} from '@service-scheduled-action/generated/schemas';
import { Tabs } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import type { RoutinesDiscover } from '../routines/components/routines-list';
import {
  availableTemplates,
  newRoutineDraft,
} from '../routines/core/routine-templates';
import { useLoadedRoutineCatalog } from '../routines/queries/catalog';
import { draftToCreateBody } from '../routines/queries/routine-draft';
import { useCreateScheduleMutation } from '../routines/queries/schedules';
import { startRoutineDraft } from '../routines/routine-draft-start';
import { RoutineSuggestionsCard } from './components/routine-suggestions-card';
import { RoutineSuggestionsDialog } from './components/routine-suggestions-dialog';
import { hasUnseenPicks } from './core/discover';
import {
  discoverItems,
  type SuggestionContext,
  type SuggestionItem,
  stackLooks,
  suggestionItem,
  suggestionsFor,
  templateItem,
} from './core/suggestions';
import {
  ROUTINE_SURFACES,
  type RoutineSurface,
  SURFACE_LABEL_KEYS,
} from './core/surfaces';
import { createDiscoverSeen } from './primitives/discover-seen';
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
  SuggestionDialogGrid,
  SuggestionDiscoverGrid,
  SuggestionRow,
  suggestionListView,
} from './views/suggestion-list-view';

/**
 * The suggestions as cards, with the routine each saves, and Macro's
 * templates; each undefined until it loads.
 */
function useSuggestionItems() {
  const source = useRoutineSuggestions();
  const catalog = useLoadedRoutineCatalog();
  const hasPaidAccess = useHasPaidAccess();
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const starterTemplates = useFeatureFlag(enableRoutineStarterTemplates);
  const decisions = useFeatureFlag(enableRoutineConditions);
  const context = createMemo((): SuggestionContext => {
    const model = defaultModelForPlan(hasPaidAccess());
    return {
      target: { kind: 'model', model },
      codeSteps: codeSteps().enabled,
      base: newRoutineDraft(undefined, {
        defaultModel: model,
        codeSteps: codeSteps().enabled,
      }),
    };
  });
  // The query keeps unchanged suggestions' objects (it reconciles by id), so
  // their cards keep theirs too and don't remount on every poll.
  const known = createMemo(() => {
    catalog();
    context();
    return new WeakMap<RoutineSuggestion, SuggestionItem | null>();
  });
  const items = createMemo((): SuggestionItem[] | undefined => {
    const suggestions = source.suggestions();
    const entries = catalog();
    if (!suggestions || !entries) return undefined;
    const cache = known();
    return suggestions.flatMap((suggestion) => {
      let item = cache.get(suggestion);
      if (item === undefined) {
        item = suggestionItem(suggestion, entries, context()) ?? null;
        cache.set(suggestion, item);
      }
      return item ? [item] : [];
    });
  });
  const templates = createMemo((): SuggestionItem[] | undefined => {
    const entries = catalog();
    if (!entries) return undefined;
    if (!starterTemplates().enabled) return [];
    return availableTemplates(entries, decisions().enabled).map((entry) =>
      templateItem(entry, context())
    );
  });
  return { source, items, templates };
}

/**
 * Suggestions with the actions that turn them on, open them in the editor,
 * and dismiss them. Built only where a list is on screen.
 */
function useSuggestionList(
  placement: () => SuggestionPlacement,
  onLeave: () => void
) {
  const layout = useSplitLayout();
  const { source, items, templates } = useSuggestionItems();
  const create = useCreateScheduleMutation();
  const ensureTagSet = useEnsureTagSetMutation();
  const dismiss = useDismissRoutineSuggestionMutation();

  const actions = createSuggestionActions({
    placement,
    async create(draft, item) {
      // A tagging routine adds the person's own tags, which must exist.
      if (item.needsPersonalTags)
        await ensureTagSet.mutateAsync({ scope: 'user' });
      const created = await create.mutateAsync({
        body: draftToCreateBody(draft),
        ...(item.template ? {} : { suggestionId: item.id }),
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
    templates,
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

/** Which kind of suggestion the sidebar dialog shows. */
type KindFilter = SuggestionFrom | 'all';

/** The sidebar dialog's cards for one surface, of the kind picked. */
function SurfaceSuggestions(props: {
  surface: RoutineSurface;
  kind: KindFilter;
  onLeave(): void;
}) {
  const list = useSuggestionList(
    () => ({ kind: 'sidebar', surface: props.surface }),
    () => props.onLeave()
  );
  const visible = createMemo(() => {
    const items = suggestionsFor(list.items(), props.surface);
    if (!items) return undefined;
    const kept = list.actions.visible(items);
    return props.kind === 'all'
      ? kept
      : kept.filter((item) => item.from === props.kind);
  });
  const view = () =>
    suggestionListView({
      suggestions: visible(),
      generating: list.source.generating(),
      failed: list.source.failed(),
    });
  usePending('routine_suggestions.load', () => view().kind === 'loading');
  return (
    <SuggestionDialogGrid
      view={view()}
      actions={list.actions}
      surface={props.surface}
      emptyLabel={t('routineSuggestions.emptySurface', {
        surface: t(SURFACE_LABEL_KEYS[props.surface]),
      })}
      onRetry={list.source.retry}
      onOpenRoutine={list.openRoutine}
    />
  );
}

/**
 * The suggestions card at the top of a view sidebar, which opens that
 * surface's suggestions. It shows only while there are some, never on touch,
 * and its close button hides it on every device, with Undo.
 */
export function SidebarRoutineSuggestions(props: {
  surface: RoutineSurface;
  class?: string;
}) {
  const enabled = useRoutineSuggestionsEnabled();
  return (
    <Show when={enabled() && !isTouchDevice()}>
      <SidebarCard surface={props.surface} class={props.class} />
    </Show>
  );
}

function SidebarCard(props: { surface: RoutineSurface; class?: string }) {
  const layout = useSplitLayout();
  const { source, items } = useSuggestionItems();
  const forSurface = createMemo(() => suggestionsFor(items(), props.surface));
  const visibility = createPromotionVisibility(
    () => `routine-suggestions:${props.surface}`,
    () => {
      const current = forSurface();
      return current === undefined ? undefined : current.length > 0;
    }
  );
  const [open, setOpen] = createSignal(false);
  const [kind, setKind] = createSignal<SuggestionFrom>();
  const label = () => t(SURFACE_LABEL_KEYS[props.surface]);
  const counts = () => {
    const current = forSurface() ?? [];
    return {
      forYou: current.filter((item) => item.from === 'for_you').length,
      templates: current.filter((item) => item.from !== 'for_you').length,
    };
  };
  // Tabs only when there are both kinds; For you first while it has any.
  const shownKind = (): KindFilter => {
    const { forYou, templates } = counts();
    if (!forYou || !templates) return 'all';
    return kind() ?? 'for_you';
  };
  const openDialog = () => {
    analytics.track('routine_suggestions_opened', {
      surface: props.surface,
      suggestions: forSurface()?.length ?? 0,
    });
    // The dialog's list flow joins this, so one trace runs to its cards.
    const interaction = beginInteraction('routine_suggestions.open', {
      attributes: { 'routine.suggestion.surface': props.surface },
      closeOnJoin: true,
    });
    try {
      setKind(undefined);
      setOpen(true);
    } finally {
      interaction.end();
    }
  };
  const hide = () => {
    analytics.track('routine_suggestions_card_dismissed', {
      surface: props.surface,
    });
    setOpen(false);
    const pending = visibility.dismissUndoably();
    const surface = props.surface;
    const toastId = toast.success(
      t('routineSuggestions.hiddenToast', { surface: label() }),
      {
        subtext: t('routineSuggestions.hiddenToastHint'),
        dismissStyle: 'icon',
        actions: [
          {
            label: t('entityActions.undo'),
            icon: ArrowCounterClockwiseIcon,
            onClick() {
              pending.undo();
              analytics.track('routine_suggestions_card_restored', {
                surface,
              });
              if (toastId !== undefined) toast.dismiss(toastId);
            },
          },
        ],
        // Only a toast that closed without Undo dismisses everywhere.
        onDismiss: pending.commit,
      }
    );
  };
  return (
    <>
      <CollapseTransition open={visibility.shown() === true}>
        <div class={props.class}>
          <RoutineSuggestionsCard
            count={forSurface()?.length ?? 0}
            titles={(forSurface() ?? []).map((item) => item.title)}
            looks={stackLooks(forSurface() ?? [], props.surface)}
            surfaceLabel={label()}
            onOpen={openDialog}
            onDismiss={hide}
          />
        </div>
      </CollapseTransition>
      <RoutineSuggestionsDialog
        open={open()}
        onOpenChange={setOpen}
        title={t('routineSuggestions.dialogTitle', { surface: label() })}
        description={
          props.surface === 'email'
            ? t('routineSuggestions.dialogDescriptionEmail')
            : t('routineSuggestions.dialogDescription')
        }
        tabs={
          <Show when={shownKind() !== 'all'}>
            <Tabs
              aria-label={t('routineSuggestions.kindLabel')}
              size="sm"
              options={[
                {
                  value: 'for_you',
                  label: t('routineSuggestions.forYou'),
                  count: counts().forYou,
                },
                {
                  value: 'macro',
                  label: t('routineSuggestions.templates'),
                  count: counts().templates,
                },
              ]}
              value={shownKind() === 'all' ? undefined : shownKind()}
              onChange={setKind}
            />
          </Show>
        }
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
            kind={shownKind()}
            onLeave={() => setOpen(false)}
          />
        </TraceFlow>
      </RoutineSuggestionsDialog>
    </>
  );
}

/** Everything Discover offers, picks first, with cards turned on here kept in place. */
function useDiscoverItems(list: ReturnType<typeof useSuggestionList>) {
  return createMemo(() => {
    const items = list.items();
    const templates = list.templates();
    if (!items || !templates) return undefined;
    return discoverItems(list.actions.visible(items), templates);
  });
}

/**
 * The routine suggestions the For you page shows: opening one for review,
 * and saving it as a routine. Their wording comes with the feed. Enabling one twice saves one routine.
 */
export function useForYouRoutineSuggestions() {
  const list = useSuggestionList(
    () => ({ kind: 'forYou' }),
    () => {}
  );
  const find = (suggestionId: string) =>
    list.items()?.find((item) => item.id === suggestionId);

  return {
    review(suggestionId: string) {
      const item = find(suggestionId);
      if (item) list.actions.customize(item);
    },
    async turnOn(suggestionId: string) {
      const item = find(suggestionId);
      if (!item) throw new Error('Routine suggestion is not loaded');

      await list.actions.enable(item);
      const status = list.actions.statusFor(item);
      if (status.kind === 'failed') throw new Error(status.message);
    },
  };
}

/** The one row of suggestions above the routines list. */
function RoutinesSuggestionRow(props: { onOpenDiscover(): void }) {
  const list = useSuggestionList(
    () => ({ kind: 'routines' }),
    () => {}
  );
  const items = useDiscoverItems(list);
  usePending('routine_suggestions.load', () => items() === undefined);
  return (
    <Show when={(items()?.length ?? 0) > 0 && items()}>
      {(current) => (
        <SuggestionRow
          items={current()}
          actions={list.actions}
          onOpenDiscover={props.onOpenDiscover}
          onOpenRoutine={list.openRoutine}
        />
      )}
    </Show>
  );
}

type AreaFilter = RoutineSurface | 'all';

/** Whether a card matches the routines search. */
function matchesSearch(item: SuggestionItem, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return `${item.title} ${item.summary} ${item.chain.trigger} ${item.chain.action}`
    .toLowerCase()
    .includes(query);
}

/** Discover: every suggestion and template, filtered by part of the app. */
function RoutinesDiscoverPage(props: { search: Accessor<string> }) {
  const list = useSuggestionList(
    () => ({ kind: 'routines' }),
    () => {}
  );
  const all = useDiscoverItems(list);
  const [area, setArea] = createSignal<AreaFilter>('all');
  const areas = createMemo(() => {
    const present = new Set(all()?.flatMap((item) => item.surfaces));
    return [
      { value: 'all' as const, label: t('routineSuggestions.allAreas') },
      ...ROUTINE_SURFACES.filter((surface) => present.has(surface)).map(
        (surface) => ({ value: surface, label: t(SURFACE_LABEL_KEYS[surface]) })
      ),
    ];
  });
  const visible = () => {
    const current = area();
    const items = current === 'all' ? all() : suggestionsFor(all(), current);
    return items?.filter((item) => matchesSearch(item, props.search()));
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
      aria-label={t('routineSuggestions.discover')}
      class="flex min-w-0 flex-col gap-3.5 px-4 pt-4 pb-6"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-3">
        <Show when={areas().length > 2}>
          <Tabs
            aria-label={t('routineSuggestions.areaLabel')}
            size="sm"
            wrap
            options={areas()}
            value={area()}
            onChange={setArea}
          />
        </Show>
        <span class="ml-auto flex items-center gap-1 text-xs text-ink-extra-muted">
          <SparkleIcon class="size-3 text-violet-ink" aria-hidden="true" />
          {t('routineSuggestions.discoverHint')}
        </span>
      </div>
      <SuggestionDiscoverGrid
        view={view()}
        actions={list.actions}
        emptyLabel={
          props.search().trim()
            ? t('routineSuggestions.noMatches')
            : t('routineSuggestions.empty')
        }
        onRetry={list.source.retry}
        onOpenRoutine={list.openRoutine}
      />
    </section>
  );
}

/**
 * What the Routines page shows of suggestions: one row above the list, and
 * the Discover tab with a violet dot while it has AI picks the person hasn't
 * seen there. Undefined where suggestions are off, and on touch.
 */
export function useRoutinesDiscover(): Accessor<RoutinesDiscover | undefined> {
  const enabled = useRoutineSuggestionsEnabled();
  const source = useRoutineSuggestions();
  const seen = createDiscoverSeen(useUserId());
  const picks = () =>
    (source.suggestions() ?? [])
      .filter((suggestion) => suggestion.from === 'for_you')
      .map((suggestion) => suggestion.id);
  const discover: RoutinesDiscover = {
    row: (openDiscover) => (
      <TraceFlow
        name="routine_suggestions.list"
        attributes={{ 'routine.suggestion.placement': 'routines' }}
      >
        <RoutinesSuggestionRow onOpenDiscover={openDiscover} />
      </TraceFlow>
    ),
    page: (search) => (
      <TraceFlow
        name="routine_suggestions.list"
        attributes={{ 'routine.suggestion.placement': 'discover' }}
      >
        <RoutinesDiscoverPage search={search} />
      </TraceFlow>
    ),
    unseen: () => hasUnseenPicks(picks(), seen.seen()),
    onSeen: () => seen.markSeen(picks()),
  };
  return () => (enabled() && !isTouchDevice() ? discover : undefined);
}
