import type { Harness } from '@service-storage/client';
import { describe, expect, it } from 'vitest';
import {
  incomingRequestCount,
  pendingRuntimeRequests,
} from './pending-requests';

const machine = { id: 'm-1', name: 'Mac mini' } as Harness;
const theirs = { id: 'm-2', name: 'Build box' } as Harness;
const request = (id: string, status: 'pending' | 'denied') => ({
  id,
  requesterId: `macro|${id}@x.test`,
  requestedLevel: 'edit' as const,
  status,
  revision: 1,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

describe('incomingRequestCount', () => {
  it('counts every request waiting across the viewer’s machines', () => {
    expect(
      incomingRequestCount([
        {
          harness: machine,
          state: {
            canReview: true,
            supportedLevels: ['edit'],
            requests: [request('a', 'pending')],
            pendingCount: 3,
          },
        },
        {
          harness: theirs,
          state: {
            canReview: true,
            supportedLevels: ['edit'],
            requests: [request('b', 'pending')],
            pendingCount: 1,
          },
        },
        { harness: machine, state: undefined },
      ])
    ).toBe(4);
  });
});

describe('pendingRuntimeRequests', () => {
  it('keeps only requests still waiting', () => {
    expect(
      pendingRuntimeRequests(
        [
          {
            harness: machine,
            state: {
              canReview: true,
              supportedLevels: ['edit'],
              requests: [request('a', 'pending'), request('b', 'denied')],
              pendingCount: 1,
            },
          },
        ],
        [
          {
            harness: theirs,
            state: {
              canReview: false,
              supportedLevels: ['edit'],
              mine: request('c', 'denied'),
              requests: [],
              pendingCount: 0,
            },
          },
        ]
      )
    ).toEqual({
      incoming: [{ harness: machine, request: request('a', 'pending') }],
      outgoing: [],
    });
  });
});
