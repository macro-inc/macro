import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import {
  bumpRowVersion,
  markRowVersioned,
} from '../../../graphql-cache/exchange/live-query';
import { createServerRowShaper } from './server-row-shaper';

const shaped = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./channel-list-row', async (importActual) => {
  const actual = await importActual<typeof import('./channel-list-row')>();
  return {
    ...actual,
    channelListRow: (record: { __typename: string }) => {
      shaped.calls += 1;
      return actual.channelListRow(record);
    },
  };
});

afterEach(() => {
  shaped.calls = 0;
});

const channel = (id: string) => ({
  __typename: 'GraphqlSoupChannel',
  id,
  channelName: `channel ${id}`,
  channelType: 'PUBLIC',
  ownerId: 'u-owner',
  channelTeamId: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  viewedAt: null,
  interactedAt: null,
  isParticipant: true,
  frecencyScore: 1,
  isFavorited: false,
  participants: [{ userId: 'u-1' }],
  latestMessage: null,
  latestNonThreadMessage: null,
});

it('shapes a versioned record again only when its version moves', () => {
  createRoot((dispose) => {
    const shape = createServerRowShaper();
    const record = channel('a');
    markRowVersioned(record);
    const first = shape(record);
    expect(shape(record)).toBe(first);
    expect(shaped.calls).toBe(1);

    // A version bump that changes nothing the row shows keeps the row.
    bumpRowVersion(record);
    expect(shape(record)).toBe(first);
    expect(shaped.calls).toBe(2);
    expect(shape(record)).toBe(first);
    expect(shaped.calls).toBe(2);

    // An in-place change the row shows gives a new row.
    record.channelName = 'renamed';
    bumpRowVersion(record);
    const renamed = shape(record);
    expect(renamed).not.toBe(first);
    expect(renamed).toMatchObject({ name: 'renamed' });
    dispose();
  });
});

it('shapes an immutable record once', () => {
  const shape = createServerRowShaper();
  const record = channel('b');
  const first = shape(record);
  expect(shape(record)).toBe(first);
  expect(shaped.calls).toBe(1);
});

it('shapes an unversioned store each time, so it sees field changes', () => {
  createRoot((dispose) => {
    const shape = createServerRowShaper();
    const [record, setRecord] = createStore(channel('c'));
    const first = shape(record);
    setRecord('channelName', 'renamed');
    const second = shape(record);
    expect(shaped.calls).toBe(2);
    expect(second).not.toBe(first);
    expect(second).toMatchObject({ name: 'renamed' });
    dispose();
  });
});

it('passes rows and other Soup types through', () => {
  const shape = createServerRowShaper();
  const row = shape(channel('d'));
  expect(shape(row)).toBe(row);
  const document = { __typename: 'GraphqlSoupDocument', id: 'doc' };
  expect(shape(document)).toBe(document);
});
