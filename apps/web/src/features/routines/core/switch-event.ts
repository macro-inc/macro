import {
  type EventTriggerDraft,
  eventScopeKind,
  eventTriggerLabel,
  type PayloadTestDraft,
  routineEvents,
} from './routine-triggers';

/** Keep what still applies when an event trigger switches to another event. */
export function switchEvent(
  current: EventTriggerDraft,
  next: EventTriggerDraft
): EventTriggerDraft {
  // Choosing the event it already has changes nothing.
  if (eventTriggerLabel(next) === eventTriggerLabel(current)) return current;
  const sameItems = eventScopeKind(current) === eventScopeKind(next);
  return {
    ...current,
    events: next.events,
    ids: sameItems ? current.ids : next.ids,
    ...switchGithub(current, next),
  };
}

const sameTest = (left: PayloadTestDraft, right: PayloadTestDraft) =>
  left.path === right.path &&
  left.op === right.op &&
  left.value === right.value;

/**
 * Moving between GitHub choices takes the new choice's events, actions and
 * payload tests, but keeps what the person narrowed it to: repositories, bots,
 * and the tests they added on top of the old choice.
 */
function switchGithub(
  current: EventTriggerDraft,
  next: EventTriggerDraft
): Pick<EventTriggerDraft, 'github' | 'match'> {
  if (!current.github || !next.github)
    return { github: next.github, match: next.match };
  const preset = routineEvents.find(
    (item) =>
      item.value === 'github' && item.label === eventTriggerLabel(current)
  )?.preset;
  const added = (current.match ?? []).filter(
    (test) => !preset?.match?.some((own) => sameTest(own, test))
  );
  const nextTests = next.match ?? [];
  const kept = added.filter(
    (test) => !nextTests.some((own) => own.path === test.path)
  );
  const match = [...nextTests, ...kept];
  return {
    github: {
      ...next.github,
      repositories: current.github.repositories,
      includeBots: current.github.includeBots,
    },
    // Set even when empty: the old choice's own tests must not carry over.
    match: match.length ? match : undefined,
  };
}
