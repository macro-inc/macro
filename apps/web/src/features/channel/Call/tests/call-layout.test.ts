import { expect, it } from 'vitest';
import {
  activeCallPin,
  normalizeCallLayout,
  sameCallPin,
  selectCallStageParticipant,
} from '../call-layout';

it('rejects stale layout preferences and retains supported choices', () => {
  expect(normalizeCallLayout('old-layout')).toBe('auto');
  expect(normalizeCallLayout(null)).toBe('auto');
  expect(normalizeCallLayout('grid')).toBe('grid');
  expect(normalizeCallLayout('speaker')).toBe('speaker');
  expect(normalizeCallLayout('sidebar')).toBe('sidebar');
});

it('uses the speaking participant with a deterministic quiet fallback', () => {
  const people = [
    { id: 'first', speaking: false },
    { id: 'second', speaking: true },
  ];
  expect(
    selectCallStageParticipant(people, (person) => person.speaking, false)
  ).toBe(people[1]);
  people[1].speaking = false;
  expect(
    selectCallStageParticipant(people, (person) => person.speaking, true)
  ).toBe('local');
  expect(
    selectCallStageParticipant(people, (person) => person.speaking, false)
  ).toBe(people[0]);
  expect(selectCallStageParticipant([], () => false, false)).toBe('local');
});

it('invalidates a pin when its participant or screen disappears', () => {
  const first = { identity: 'first' };
  const returning = { identity: 'first' };
  const share = { share: first };
  expect(activeCallPin(first, [first], [], false)).toBe(first);
  expect(activeCallPin(first, [returning], [], false)).toBeUndefined();
  expect(activeCallPin(share, [first], [first], false)).toBe(share);
  expect(activeCallPin(share, [first], [], false)).toBeUndefined();
  expect(activeCallPin('local-share', [], [], false)).toBeUndefined();
  expect(activeCallPin('local', [], [], false)).toBeUndefined();
  expect(sameCallPin(share, { share: first })).toBe(true);
  expect(sameCallPin(first, share)).toBe(false);
});
