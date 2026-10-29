import type { EntityData } from '@entity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/features/entity/bulk-edit/BulkEditEntityModal', () => ({
  openBulkEditModal: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('../utils', () => ({
  restoreSoupFocus: vi.fn(),
}));

import { makeMoveToProjectAction } from './make-move-to-project-action';

const entity = (type: EntityData['type']) =>
  ({ type, id: 'e1', name: 'Thing', ownerId: 'macro|me' }) as EntityData;

const { canExecute } = makeMoveToProjectAction({ userId: () => 'macro|me' });

describe('makeMoveToProjectAction.canExecute', () => {
  it('offers moving what the move mutation moves', () => {
    expect(canExecute(entity('document'))).toBe(true);
    expect(canExecute(entity('chat'))).toBe(true);
    expect(canExecute(entity('project'))).toBe(true);
    expect(canExecute(entity('email'))).toBe(true);
  });

  it('refuses items someone else owns', () => {
    expect(
      canExecute({
        ...entity('document'),
        ownerId: 'macro|other',
      } as EntityData)
    ).toBe(false);
  });

  it('refuses types the move mutation rejects', () => {
    expect(canExecute(entity('call'))).toBe(false);
    expect(canExecute(entity('calendar_event'))).toBe(false);
    expect(canExecute(entity('routine'))).toBe(false);
    expect(canExecute(entity('agent_session'))).toBe(false);
  });
});
