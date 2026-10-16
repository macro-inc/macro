import { createSignal } from 'solid-js';
import { vi } from 'vitest';
import type { SharingSource } from '../context/contracts';
import type { RequestState } from '../core/types';

export function fakeSharingSource(initial: Partial<RequestState> = {}) {
  const [state, setState] = createSignal<RequestState>({
    owner: 'macro|owner@test.com',
    canReview: false,
    accessLevel: 'view',
    supportedLevels: ['view', 'comment', 'edit'],
    requests: [],
    pendingCount: 0,
    ...initial,
  });
  const source: SharingSource = {
    state,
    grants: () => [],
    loading: () => false,
    busy: () => false,
    error: () => undefined,
    refresh: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
    setGrant: vi.fn(async () => {}),
    nextPage: vi.fn(),
    firstPage: vi.fn(),
  };
  return { source, setState };
}
