import type { EntityData } from '@entity';
import { describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ graphqlSoup: false }));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isFeatureEnabled: () => flags.graphqlSoup,
}));
vi.mock('@entity', () => ({
  createBulkCopyDssEntityMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), dismiss: vi.fn() },
}));

import { makeCopyAction } from './make-copy-action';

const entity = (type: EntityData['type']) =>
  ({ type, id: 'e1', name: 'Thing', ownerId: 'macro|me' }) as EntityData;

const { canExecute } = makeCopyAction();

describe('makeCopyAction.canExecute', () => {
  it('offers duplicating documents and chats', () => {
    expect(canExecute(entity('document'))).toBe(true);
    expect(canExecute(entity('chat'))).toBe(true);
  });

  it('duplicates folders only through the GraphQL entity mutation', () => {
    flags.graphqlSoup = true;
    expect(canExecute(entity('project'))).toBe(true);
    flags.graphqlSoup = false;
    expect(canExecute(entity('project'))).toBe(false);
  });

  it('refuses types the copy mutation rejects', () => {
    expect(canExecute(entity('call'))).toBe(false);
    expect(canExecute(entity('calendar_event'))).toBe(false);
  });
});
