import { For } from 'solid-js';
import {
  RoutineSuggestionList,
  type SuggestionListView,
} from '../components/routine-suggestion-list';
import {
  RoutineSuggestionRow,
  SuggestionEnableButton,
} from '../components/routine-suggestion-row';
import type { RoutineSuggestion } from '../core/suggestions';
import { routineSurfaceCopy } from '../core/surfaces';
import type { SuggestionActions } from '../primitives/suggestion-actions';

/** Derives the list state; cached suggestions stay visible through refreshes. */
export function suggestionListView(input: {
  suggestions: RoutineSuggestion[] | undefined;
  generating: boolean;
  failed: boolean;
}): SuggestionListView {
  if (input.suggestions?.length) {
    return { kind: 'items', items: input.suggestions };
  }
  if (input.generating) return { kind: 'loading' };
  if (input.failed && input.suggestions === undefined) return { kind: 'error' };
  if (input.suggestions === undefined) return { kind: 'loading' };
  return { kind: 'empty' };
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
          <For each={items}>
            {(suggestion) => (
              <RoutineSuggestionRow
                suggestion={suggestion}
                edits={props.actions.editsFor(suggestion)}
                status={props.actions.statusFor(suggestion)}
                expanded={props.actions.isExpanded(suggestion)}
                surfaceLabel={
                  props.showSurface
                    ? routineSurfaceCopy[suggestion.surface].label
                    : undefined
                }
                onExpandedChange={(expanded) =>
                  props.actions.setExpanded(suggestion, expanded)
                }
                onEdit={(edits) => props.actions.edit(suggestion, edits)}
                onCustomize={() => props.actions.customize(suggestion)}
                action={
                  <SuggestionEnableButton
                    name={
                      props.actions.editsFor(suggestion).title ||
                      suggestion.title
                    }
                    status={props.actions.statusFor(suggestion)}
                    onEnable={() => props.actions.enable(suggestion)}
                    onOpenRoutine={props.onOpenRoutine}
                  />
                }
              />
            )}
          </For>
        </ul>
      )}
    </RoutineSuggestionList>
  );
}
