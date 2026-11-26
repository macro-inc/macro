import { expect, test } from 'bun:test';
import { createPasswordFixture, sampleTeam } from './fixture';
import type { SaveItem } from './storage';

test('enforces the team, role and version at the fixture storage boundary', () => {
  const member = createPasswordFixture('?actor=member');
  const creator = createPasswordFixture('?actor=creator');
  const edit = {
    id: 'docs',
    expectedVersion: 1,
    name: 'Renamed fixture',
    fields: {},
    filled: { password: true },
  } satisfies SaveItem;

  expect(member.detail(sampleTeam, 'docs')).toBeUndefined();
  expect(member.save(sampleTeam, edit)).toBeUndefined();
  expect(
    member.save(sampleTeam, {
      kind: 'login',
      name: 'Login',
      fields: {},
      filled: {},
    })
  ).toBeUndefined();
  expect(creator.read('foreign').items).toEqual([]);
  expect(creator.save('foreign', edit)).toBeUndefined();
  expect(creator.save(sampleTeam, edit)).toBe('docs');
  expect(
    creator.save(sampleTeam, { ...edit, name: 'Stale change' })
  ).toBeUndefined();
  expect(creator.detail(sampleTeam, 'docs')?.name).toBe('Renamed fixture');
});

test('setup failures keep the vault empty and block subsequent writes', () => {
  const card = {
    kind: 'card',
    name: 'Fixture card',
    fields: {},
    filled: { cardNumber: true, securityCode: true },
    fixtureUseWhen: 'For renewals',
  } satisfies SaveItem;
  const ready = createPasswordFixture('?case=empty');
  const recovery = createPasswordFixture('?case=recovery');

  expect(ready.save(sampleTeam, card)).toBe('local-1');
  expect(ready.read(sampleTeam).readiness).toBe('ready');
  expect(ready.detail(sampleTeam, 'local-1')?.filled).toEqual({
    cardNumber: true,
    securityCode: true,
  });
  expect(recovery.save(sampleTeam, card)).toBeUndefined();
  expect(recovery.read(sampleTeam).readiness).toBe('recovery');
  expect(recovery.save(sampleTeam, card)).toBeUndefined();
  expect(recovery.read(sampleTeam).items).toEqual([]);
});
