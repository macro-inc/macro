import { fireAndForget } from '@core/util/fireAndForget';
import { For, onMount } from 'solid-js';
import {
  RoutineSuggestionList,
  type SuggestionListView,
} from '../components/routine-suggestion-list';
import {
  RoutineSuggestionRow,
  SuggestionEnableButton,
  SuggestionReviewButton,
} from '../components/routine-suggestion-row';
import type { SuggestionItem } from '../core/suggestions';
import { SURFACE_COPY } from '../core/surfaces';
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

function SuggestionRowItem(props: {
  suggestion: SuggestionItem;
  /** The rows above it, top first. */
  above: () => string[];
  actions: SuggestionActions;
  showSurface?: boolean;
  onOpenRoutine(routineId: string): void;
}) {
  onMount(() => props.actions.shown(props.suggestion));
  const name = () =>
    props.actions.editsFor(props.suggestion).title || props.suggestion.title;
  const status = () => props.actions.statusFor(props.suggestion);
  const surfaceLabel = () => {
    const main = props.suggestion.surfaces[0];
    return props.showSurface && main ? SURFACE_COPY[main].label : undefined;
  };
  return (
    <RoutineSuggestionRow
      suggestion={props.suggestion}
      edits={props.actions.editsFor(props.suggestion)}
      status={status()}
      expanded={props.actions.isExpanded(props.suggestion)}
      surfaceLabel={surfaceLabel()}
      onExpandedChange={(expanded) =>
        props.actions.setExpanded(props.suggestion, expanded)
      }
      onEdit={(edits) => props.actions.edit(props.suggestion, edits)}
      onCustomize={() => props.actions.customize(props.suggestion)}
      onDismiss={() =>
        fireAndForget(
          props.actions.dismiss(props.suggestion),
          'routine-suggestions.dismiss'
        )
      }
      action={
        props.suggestion.reviewFirst && status().kind !== 'enabled' ? (
          <SuggestionReviewButton
            name={name()}
            onReview={() => props.actions.customize(props.suggestion)}
          />
        ) : (
          <SuggestionEnableButton
            name={name()}
            status={status()}
            onEnable={() =>
              fireAndForget(
                props.actions.enable(props.suggestion, props.above()),
                'routine-suggestions.enable'
              )
            }
            onOpenRoutine={props.onOpenRoutine}
          />
        )
      }
    />
  );
}

/** A list of suggestion rows wired to their per-row actions. */
export function SuggestionRows(props: {
  view: SuggestionListView;
  actions: SuggestionActions;
  emptyLabel: string;
  /** Label each row with its surface, for lists that mix surfaces. */
  showSurface?: boolean;
  onRetry(): void;
  onOpenRoutine(routineId: string): void;
}) {
  return (
    <RoutineSuggestionList
      view={props.view}
      emptyLabel={props.emptyLabel}
      onRetry={props.onRetry}
    >
      {(items) => (
        <ul class="flex flex-col gap-1" aria-label="Suggested routines">
          <For each={items()}>
            {(suggestion, index) => (
              <SuggestionRowItem
                suggestion={suggestion}
                above={() =>
                  items()
                    .slice(0, index())
                    .map((item) => item.id)
                }
                actions={props.actions}
                showSurface={props.showSurface}
                onOpenRoutine={props.onOpenRoutine}
              />
            )}
          </For>
        </ul>
      )}
    </RoutineSuggestionList>
  );
}
