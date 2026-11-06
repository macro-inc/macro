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
import {
  RoutineCard,
  RoutineCardStrip,
} from '../routines/components/routine-template-strip';
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
import { suggestionCard } from './core/suggestion-draft';
import { type RoutineSurface, SURFACE_COPY } from './core/surfaces';
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

/** Suggestions as cards, dropping those the catalog can't show. */
function cards(
  suggestions: readonly RoutineSuggestion[],
  catalog: readonly RoutineTemplate[]
) {
  return suggestions.flatMap((suggestion) => {
    const entry =
      suggestion.kind === 'starter'
        ? catalog.find((routine) => routine.key === suggestion.key)
        : undefined;
    const card = suggestionCard(suggestion, entry);
    return card ? [{ suggestion, card }] : [];
  });
}

/**
 * Suggestions as routine cards, the same cards templates use. Choosing one
 * opens it for review; its corner button is Not interested. The actions are
 * built only while shown, since the drafter's workspace context loads
 * several lists.
 */
function SuggestionCards(props: {
  suggestions: readonly RoutineSuggestion[];
  on: 'page' | 'dialog';
  onLeave?: () => void;
}) {
  const catalog = useRoutineCatalog();
  const actions = useProductionActions(() => props.onLeave?.());
  return (
    <For each={cards(props.suggestions, catalog())}>
      {({ suggestion, card }) => (
        <RoutineCard
          on={props.on}
          card={card}
          label={`Review ${card.title}`}
          status={
            actions.pending() === suggestion.id
              ? suggestion.kind === 'request'
                ? 'Drafting…'
                : 'Opening…'
              : undefined
          }
          disabled={actions.pending() !== undefined}
          onUse={() =>
            fireAndForget(
              actions.review(suggestion),
              'routine-suggestions.review'
            )
          }
          onDismiss={() => actions.dismiss(suggestion)}
          dismissLabel={`Not interested in ${card.title}`}
        />
      )}
    </For>
  );
}

/** Every suggestion given, as cards in a dialog. */
function SuggestionsDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  suggestions: readonly RoutineSuggestion[];
  refreshing: boolean;
}) {
  const layout = useSplitLayout();
  return (
    <RoutineSuggestionsDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      refreshing={props.refreshing}
      onRefresh={() =>
        fireAndForget(refreshRoutineSuggestions(), 'routine-suggestions')
      }
      onSeeAll={() => {
        props.onOpenChange(false);
        openAgentsPage(layout, 'routines');
      }}
    >
      <div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2.5">
        <SuggestionCards
          on="dialog"
          suggestions={props.suggestions}
          onLeave={() => props.onOpenChange(false)}
        />
      </div>
    </RoutineSuggestionsDialog>
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
  const catalog = useRoutineCatalog();
  const teaser = () => {
    const [first] = cards(forSurface() ?? [], catalog());
    return first?.card.title ?? SURFACE_COPY[props.surface].pitch;
  };
  return (
    <Show when={visibility.shown()}>
      <CardAndDialog
        surface={props.surface}
        class={props.class}
        suggestions={forSurface() ?? []}
        teaser={teaser()}
        refreshing={source.generating()}
        onDismissCard={() => {
          analytics.track('routine_suggestions_card_dismissed', {
            surface: props.surface,
          });
          visibility.dismiss();
        }}
      />
    </Show>
  );
}

/**
 * The card and its dialog. The dialog's open state lives here, so it closes
 * when the card goes away (its last suggestion dismissed) and doesn't come
 * back open with the card.
 */
function CardAndDialog(props: {
  surface: RoutineSurface;
  class?: string;
  suggestions: readonly RoutineSuggestion[];
  teaser: string;
  refreshing: boolean;
  onDismissCard(): void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <RoutineSuggestionsCard
        class={props.class}
        teaser={props.teaser}
        more={Math.max(0, props.suggestions.length - 1)}
        onOpen={() => {
          analytics.track('routine_suggestions_opened', {
            surface: props.surface,
            suggestions: props.suggestions.length,
          });
          setOpen(true);
        }}
        onDismiss={() => props.onDismissCard()}
      />
      <SuggestionsDialog
        open={open()}
        onOpenChange={setOpen}
        title={`Routines for ${SURFACE_COPY[props.surface].label}`}
        suggestions={props.suggestions}
        refreshing={props.refreshing}
      />
    </>
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

/** The Routines page shows one row of this many, like its templates. */
const ROUTINES_PAGE_SHOWN = 4;

function SuggestedForYou(props: { fallback: JSX.Element }) {
  const source = useRoutineSuggestions();
  const [open, setOpen] = createSignal(false);
  // Best first across areas: AI's estimate that the person keeps it.
  const ranked = createMemo(() =>
    (source.suggestions() ?? []).toSorted(
      (a, b) => b.keepProbability - a.keepProbability
    )
  );
  return (
    <Show when={ranked().length} fallback={props.fallback}>
      <RoutineCardStrip
        heading="Suggested for you"
        allLabel="All suggestions"
        showAll={ranked().length > ROUTINES_PAGE_SHOWN}
        onAll={() => {
          analytics.track('routine_suggestions_opened', {
            surface: 'all',
            suggestions: ranked().length,
          });
          setOpen(true);
        }}
      >
        <SuggestionCards
          on="page"
          suggestions={ranked().slice(0, ROUTINES_PAGE_SHOWN)}
        />
      </RoutineCardStrip>
      <SuggestionsDialog
        open={open()}
        onOpenChange={setOpen}
        title="Suggested for you"
        suggestions={ranked()}
        refreshing={source.generating()}
      />
    </Show>
  );
}
