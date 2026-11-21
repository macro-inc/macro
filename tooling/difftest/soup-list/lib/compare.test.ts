import { expect, test } from 'bun:test';
import { compareCaller, compareData } from './compare';

const sys = { id: 'p1', definition: { id: '00000001-0000-0000-0000-000000000002', data_type: 'SELECT_STRING' }, value: null };
const team = { id: 'p2', definition: { id: '01a1fb40-0000-7000-8000-000000000000', data_type: 'SELECT_STRING' }, value: { type: 'SelectOption', value: [] } };
const tag = { id: 'p3', definition: { id: '01a1fb40-0000-7000-8000-000000000001', data_type: 'TAG' }, value: { type: 'SelectOption', value: ['o'] } };
const row = (properties: unknown[]) => [{ type: 'document', id: 'd1', properties }];

test('an extra non-system, non-tag property row is a named data difference', () => {
  const r = compareData(row([sys]), row([sys, team]));
  expect(r.equal).toBe(true);
  expect(r.ruleHits['graphql-non-tag-team-properties']).toBe(1);
});

test('an extra tag row, a missing row or a reorder is a difference', () => {
  expect(compareData(row([sys]), row([sys, tag])).equal).toBe(false);
  expect(compareData(row([sys, team]), row([sys])).equal).toBe(false);
  expect(compareData(row([sys, team]), row([team, sys, team])).equal).toBe(false);
});

test('the caller level applies no rules', () => {
  expect(compareCaller(row([sys]), row([sys, team])).equal).toBe(false);
});
