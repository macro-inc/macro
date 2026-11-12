import type {
  Suggestion as WireSuggestion,
  SuggestionFeed as WireSuggestions,
  Target as WireTarget,
} from '@service-scheduled-action/generated/schemas';
import { match, P } from 'ts-pattern';
import type {
  RunProgress,
  Suggestion,
  SuggestionCategory,
  SuggestionKind,
  SuggestionRun,
  SuggestionTarget,
} from '../core/suggestion';

function toTarget(target: WireTarget): SuggestionTarget {
  return {
    entityType: target.entityType,
    entityId: target.entityId,
    ...(target.partId ? { partId: target.partId } : {}),
  };
}

function toRun(run: WireSuggestion['run']): SuggestionRun | undefined {
  if (!run) return undefined;

  const progress = match(run.progress)
    .returnType<RunProgress>()
    .with('finished', () => 'finished')
    .with('failed', () => 'failed')
    // Runs no longer pause for the person, and one that can't be read yet is
    // still under way.
    .otherwise(() => 'running');

  return { sessionId: run.sessionId, startedAt: run.startedAt, progress };
}

function toKind(suggestion: WireSuggestion): SuggestionKind | undefined {
  return (
    match(suggestion)
      .returnType<SuggestionKind | undefined>()
      .with({ kind: 'prompt', runMode: 'background' }, (prompt) => ({
        kind: 'prompt',
        runMode: 'background',
        prompt: prompt.prompt,
        ...(prompt.sends ? { sends: prompt.sends } : {}),
        run: toRun(suggestion.run),
      }))
      .with({ kind: 'prompt' }, (prompt) => ({
        kind: 'prompt',
        runMode: 'composer',
        prompt: prompt.prompt,
      }))
      .with(
        { kind: 'entity', action: P.union('reply', 'review', 'follow_up') },
        (entity) => ({
          kind: 'entity',
          action: entity.action,
          ...(entity.draft ? { draft: toTarget(entity.draft) } : {}),
        })
      )
      .with({ kind: 'routine' }, (routine) => ({
        kind: 'routine',
        routineSuggestionId: routine.routineSuggestionId,
      }))
      // A kind or action a newer server knows and this build doesn't.
      .otherwise(() => undefined)
  );
}

const CATEGORIES: readonly string[] = [
  'important',
  'revisit',
  'save_money',
  'make_money',
] satisfies SuggestionCategory[];

function isCategory(category: string): category is SuggestionCategory {
  return CATEGORIES.includes(category);
}

/**
 * An suggestion as the feed shows it, or undefined for one this build can't show:
 * a kind it doesn't know, or a state the feed never lists.
 */
export function toSuggestion(
  suggestion: WireSuggestion
): Suggestion | undefined {
  const kind = toKind(suggestion);
  const state = match(suggestion.state)
    .returnType<Suggestion['state'] | undefined>()
    .with('proposed', 'accepted', 'done', (shown) => shown)
    .otherwise(() => undefined);
  if (!kind || !state) return undefined;

  return {
    ...kind,
    id: suggestion.id,
    title: suggestion.title,
    summary: suggestion.summary,
    importance: suggestion.importance,
    categories: suggestion.categories.filter(isCategory),
    state,
    createdAt: suggestion.createdAt,
    stateChangedAt: suggestion.stateChangedAt,
    updatedAt: suggestion.updatedAt,
    about: suggestion.about.map(toTarget),
    produced: suggestion.produced.map(toTarget),
  };
}

/** The feed's open suggestions, then the ones done lately. */
export function toSuggestions(feed: WireSuggestions): Suggestion[] {
  return [...feed.suggestions, ...feed.done].flatMap((wire) => {
    const suggestion = toSuggestion(wire);
    return suggestion ? [suggestion] : [];
  });
}
