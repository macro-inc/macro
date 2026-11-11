import type {
  Idea as WireIdea,
  Ideas as WireIdeas,
  Target as WireTarget,
} from '@service-scheduled-action/generated/schemas';
import { match, P } from 'ts-pattern';
import type {
  Idea,
  IdeaCategory,
  IdeaKind,
  IdeaRun,
  IdeaTarget,
  RunProgress,
} from '../core/idea';

function toTarget(target: WireTarget): IdeaTarget {
  return {
    entityType: target.entityType,
    entityId: target.entityId,
    ...(target.partId ? { partId: target.partId } : {}),
  };
}

function toRun(run: WireIdea['run']): IdeaRun | undefined {
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

function toKind(idea: WireIdea): IdeaKind | undefined {
  return (
    match(idea)
      .returnType<IdeaKind | undefined>()
      .with({ kind: 'prompt', runMode: 'background' }, (prompt) => ({
        kind: 'prompt',
        runMode: 'background',
        prompt: prompt.prompt,
        ...(prompt.sends ? { sends: prompt.sends } : {}),
        run: toRun(idea.run),
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
] satisfies IdeaCategory[];

function isCategory(category: string): category is IdeaCategory {
  return CATEGORIES.includes(category);
}

/**
 * An idea as the feed shows it, or undefined for one this build can't show:
 * a kind it doesn't know, or a state the feed never lists.
 */
export function toIdea(idea: WireIdea): Idea | undefined {
  const kind = toKind(idea);
  const state = match(idea.state)
    .returnType<Idea['state'] | undefined>()
    .with('proposed', 'accepted', 'done', (shown) => shown)
    .otherwise(() => undefined);
  if (!kind || !state) return undefined;

  return {
    ...kind,
    id: idea.id,
    title: idea.title,
    summary: idea.summary,
    importance: idea.importance,
    categories: idea.categories.filter(isCategory),
    state,
    createdAt: idea.createdAt,
    stateChangedAt: idea.stateChangedAt,
    updatedAt: idea.updatedAt,
    about: idea.about.map(toTarget),
    produced: idea.produced.map(toTarget),
  };
}

/** The feed's open ideas, then the ones done lately. */
export function toIdeas(feed: WireIdeas): Idea[] {
  return [...feed.ideas, ...feed.done].flatMap((wire) => {
    const idea = toIdea(wire);
    return idea ? [idea] : [];
  });
}
