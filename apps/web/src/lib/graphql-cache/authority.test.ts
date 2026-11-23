import { expect, it } from 'vitest';
import { createAuthorityObserver, StaleCacheAuthorityError } from './authority';

it('does not let a tagged read undo the first proof or account witness', () => {
  const owner = createAuthorityObserver('profile');
  const initial = {
    identity: 'profile',
    account: null,
    generation: crypto.randomUUID(),
    policy: null,
    ready: false,
  };
  owner.observe(initial);
  const version = owner.version();
  const bound = { ...initial, account: 'viewer' };
  owner.observe(bound);
  expect(() => owner.observe(initial, version)).toThrow(
    StaleCacheAuthorityError
  );
  const ready = { ...bound, policy: 'none', ready: true };
  const beforeProof = owner.version();
  owner.observe(ready);
  expect(() => owner.observe(bound, beforeProof)).toThrow(
    StaleCacheAuthorityError
  );
  expect(owner.snapshot()).toEqual(ready);
  expect(owner.observe(ready, beforeProof)).toEqual(ready);
});

it('accepts its transition completion after the corresponding begin event', () => {
  const owner = createAuthorityObserver('profile');
  owner.observe({
    identity: 'profile',
    account: 'viewer',
    generation: crypto.randomUUID(),
    policy: 'allowed',
    ready: true,
  });
  const version = owner.version();
  const beginning = {
    identity: 'profile',
    account: 'viewer',
    generation: crypto.randomUUID(),
    policy: 'denied',
    ready: false,
  };
  owner.observe(beginning);
  const completed = { ...beginning, ready: true };
  expect(owner.observe(completed, version, 'transition')).toEqual(completed);
  expect(() => owner.observe(beginning, version)).toThrow(
    StaleCacheAuthorityError
  );
});
