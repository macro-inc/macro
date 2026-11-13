import type {
  SuggestionFeed as WireFeed,
  Suggestion as WireSuggestion,
  Target as WireTarget,
} from '@service-scheduled-action/generated/schemas';
import { match, P } from 'ts-pattern';
import type {
  Suggestion,
  SuggestionCategory,
  SuggestionFeed,
  SuggestionKind,
  SuggestionStatus,
  SuggestionTarget,
} from '../core/suggestion';

function toTarget(target: WireTarget): SuggestionTarget {
  return {
    entityType: target.entityType,
    entityId: target.entityId,
    ...(target.partId ? { partId: target.partId } : {}),
  };
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
        ...(suggestion.run
          ? {
              run: {
                sessionId: suggestion.run.sessionId,
                startedAt: suggestion.run.startedAt,
              },
            }
          : {}),
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
          ...(entity.draft
            ? {
                draft: {
                  ...toTarget(entity.draft),
                  ...(entity.draft.preview
                    ? { preview: entity.draft.preview }
                    : {}),
                },
              }
            : {}),
          ...(entity.from ? { from: entity.from } : {}),
          ...(entity.waitingSince ? { waitingSince: entity.waitingSince } : {}),
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
 * A suggestion as the feed shows it, or undefined for one this build can't
 * show: a kind it doesn't know, or a status the feed never lists.
 */
export function toSuggestion(
  suggestion: WireSuggestion
): Suggestion | undefined {
  const kind = toKind(suggestion);
  const status = match(suggestion.status)
    .returnType<SuggestionStatus | undefined>()
    .with('open', 'running', 'failed', 'done', (shown) => shown)
    .otherwise(() => undefined);
  if (!kind || !status) return undefined;

  return {
    ...kind,
    id: suggestion.id,
    title: suggestion.title,
    summary: suggestion.summary,
    importance: suggestion.importance,
    categories: suggestion.categories.filter(isCategory),
    status,
    isNew: suggestion.isNew,
    createdAt: suggestion.createdAt,
    stateChangedAt: suggestion.stateChangedAt,
    updatedAt: suggestion.updatedAt,
    about: suggestion.about.map(toTarget),
    ...(suggestion.result ? { result: toTarget(suggestion.result) } : {}),
  };
}

/** The feed in the server's order: what waits or runs, then what is done. */
export function toFeed(feed: WireFeed): SuggestionFeed {
  return {
    suggestions: [...feed.suggestions, ...(feed.done ?? [])].flatMap((wire) => {
      const suggestion = toSuggestion(wire);
      return suggestion ? [suggestion] : [];
    }),
    counts: feed.counts,
  };
}
