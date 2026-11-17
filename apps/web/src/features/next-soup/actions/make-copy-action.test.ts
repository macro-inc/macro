import type { EntityData } from '@entity';
import { describe, expect, it, vi } from 'vitest';

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
  it('offers duplicating documents but not legacy chats', () => {
    expect(canExecute(entity('document'))).toBe(true);
    expect(canExecute(entity('chat'))).toBe(false);
  });

  it('duplicates folders', () => {
    expect(canExecute(entity('project'))).toBe(true);
  });

  it('refuses types the copy mutation rejects', () => {
    expect(canExecute(entity('call'))).toBe(false);
    expect(canExecute(entity('calendar_event'))).toBe(false);
  });
});
