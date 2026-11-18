import type { EntityData } from '@entity';
import { expect, it, vi } from 'vitest';
import { signalFilter } from './inbox-filters';

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_CLIENT_EMAIL_SIGNAL_FILTER: false,
}));

it('notification-only Team remains signal when returned by the server-gated inbox', () => {
  const team: EntityData = {
    type: 'team',
    id: 'team-1',
    name: 'Synthetic team',
    ownerId: 'viewer',
  };
  expect(signalFilter(team)).toBe(true);
});
