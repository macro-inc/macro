import { expect, it } from 'vitest';
import {
  normalizeCallLayout,
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
