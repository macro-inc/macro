import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
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

it('shapes a new record object, and only a new one', () => {
  const shape = createServerRowShaper();
  const record = channel('b');
  const first = shape(record);
  expect(shape(record)).toBe(first);
  expect(shaped.calls).toBe(1);
  const renamed = shape({ ...record, channelName: 'renamed' });
  expect(renamed).not.toBe(first);
  expect(renamed).toMatchObject({ name: 'renamed' });
  expect(shaped.calls).toBe(2);
});

it('refuses a store proxy in development', () => {
  createRoot((dispose) => {
    const shape = createServerRowShaper();
    const [record] = createStore(channel('c'));
    expect(() => shape(record)).toThrow('store proxy');
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
