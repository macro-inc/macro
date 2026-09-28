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

import { makeRenameAction } from './make-rename-action';

const ME = 'macro|me@macro.com';
const OTHER = 'macro|other@example.com';

const entity = (
  type: EntityData['type'],
  overrides: Partial<EntityData> = {}
) =>
  ({ type, id: 'e1', name: 'Thing', ownerId: ME, ...overrides }) as EntityData;

const channel = (
  overrides: Partial<Extract<EntityData, { type: 'channel' }>> = {}
) =>
  entity('channel', {
    channelType: 'private',
    ...overrides,
  });

const { canExecute } = makeRenameAction({ userId: () => ME });

describe('makeRenameAction.canExecute', () => {
  it('allows the owner of a private channel to rename it', () => {
    expect(canExecute(channel({ channelType: 'private', ownerId: ME }))).toBe(
      true
    );
  });

  it('allows the owner of a team channel to rename it', () => {
    expect(canExecute(channel({ channelType: 'team', ownerId: ME }))).toBe(
      true
    );
  });

  it('allows a non-owner participant to rename a channel', () => {
    expect(
      canExecute(
        channel({
          ownerId: OTHER,
          isParticipant: true,
        })
      )
    ).toBe(true);
  });

  it('treats a missing isParticipant flag as joined', () => {
    expect(canExecute(channel({ ownerId: OTHER }))).toBe(true);
  });

  it('refuses a team channel the viewer has not joined', () => {
    expect(
      canExecute(
        channel({
          channelType: 'team',
          isParticipant: false,
        })
      )
    ).toBe(false);
  });

  it('refuses direct messages', () => {
    expect(
      canExecute(channel({ channelType: 'direct_message', ownerId: ME }))
    ).toBe(false);
  });

  it('allows renaming a document the caller owns', () => {
    expect(canExecute(entity('document'))).toBe(true);
  });

  it('refuses a document owned by someone else', () => {
    expect(canExecute(entity('document', { ownerId: OTHER }))).toBe(false);
  });

  it('refuses channel messages, threads, email, and foreign rows', () => {
    expect(canExecute(entity('channel_message'))).toBe(false);
    expect(canExecute(entity('channel_thread'))).toBe(false);
    expect(canExecute(entity('email'))).toBe(false);
    expect(canExecute(entity('foreign'))).toBe(false);
  });
});
