import { expect, it, vi } from 'vitest';
import { isCacheRequest } from '../worker/coordinator-protocol';
import { createPeopleCache } from './host';
import {
  isPeopleReferenceRequest,
  type PeopleReferenceRequest,
} from './protocol';
import { unsupportedContactSync } from './test-support';

const REQUEST: PeopleReferenceRequest = {
  scope: {
    identity: 'macro|viewer@example.com',
    storageGeneration: '00000000-0000-4000-8000-000000000001',
  },
  labels: ['Sam'],
  matching: 'preferFullName',
  excludeSecondaryInboxes: true,
};

it('bounds raw reference labels and validates the complete coordinator envelope', () => {
  expect(isPeopleReferenceRequest(REQUEST)).toBe(true);
  expect(
    isPeopleReferenceRequest({ ...REQUEST, labels: Array(501).fill('Sam') })
  ).toBe(false);
  expect(
    isPeopleReferenceRequest({ ...REQUEST, labels: ['é'.repeat(257)] })
  ).toBe(false);
  expect(isPeopleReferenceRequest({ ...REQUEST, labels: [' '] })).toBe(false);
  expect(isPeopleReferenceRequest({ ...REQUEST, matching: 'guess' })).toBe(
    false
  );
  expect(isPeopleReferenceRequest({ ...REQUEST, extra: true })).toBe(false);
  expect(
    isCacheRequest({ id: 1, kind: 'people-references', request: REQUEST })
  ).toBe(true);
  expect(
    isCacheRequest({
      id: 1,
      kind: 'people-references',
      request: REQUEST,
      traceparent: 'private content',
    })
  ).toBe(false);
});

it('requires one bounded evidence group per label and preserves scope failures', async () => {
  const person = {
    userId: 'macro|sam@example.com',
    email: 'sam@example.com',
    name: 'Sam',
  };
  const response = {
    kind: 'resolved',
    policyVersion: 4,
    matches: [{ complete: true, people: [person] }],
  };
  const transport = {
    ...unsupportedContactSync,
    readSql: vi.fn().mockResolvedValue({ kind: 'unsupported' }),
    resolveReferences: vi.fn().mockResolvedValue(response),
    context: vi.fn(),
    update: vi.fn(),
    search: vi.fn(),
  };
  const cache = createPeopleCache(transport);
  await expect(cache.resolveReferences(REQUEST)).resolves.toEqual(response);
  expect(transport.resolveReferences.mock.calls[0][0]).toEqual(REQUEST);
  await expect(
    cache.resolveReferences({ ...REQUEST, labels: Array(501).fill('Sam') })
  ).rejects.toThrow('Invalid contact reference request');
  expect(transport.resolveReferences).toHaveBeenCalledOnce();
  for (const matches of [
    [],
    [{ complete: true, people: Array(3).fill(person) }],
    [{ people: [person] }],
    Array(501).fill({ complete: true, people: [] }),
  ]) {
    transport.resolveReferences.mockResolvedValue({ ...response, matches });
    await expect(cache.resolveReferences(REQUEST)).rejects.toThrow(
      'Invalid contact reference response'
    );
  }
  const stale = new Error('cache hydration scope changed');
  transport.resolveReferences.mockRejectedValue(stale);
  await expect(cache.resolveReferences(REQUEST)).rejects.toBe(stale);
  transport.resolveReferences.mockResolvedValue({ kind: 'unsupported' });
  await expect(cache.resolveReferences(REQUEST)).resolves.toEqual({
    kind: 'unsupported',
  });
});
