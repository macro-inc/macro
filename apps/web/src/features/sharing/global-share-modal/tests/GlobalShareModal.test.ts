import { Permissions } from '@core/component/SharePermissions';
import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openGlobalShareModal } from '../GlobalShareModal';

const openShareModal = vi.hoisted(() => vi.fn());
vi.mock('@core/component/TopBar/shareModal', () => ({ openShareModal }));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (entity: { type: string }) => entity.type,
}));
const openFormShareModal = vi.hoisted(() => vi.fn());
vi.mock('@app/features/block-form/form-global-sharing', () => ({
  openFormShareModal,
}));

beforeEach(() => {
  openShareModal.mockReset();
  openFormShareModal.mockReset();
});

describe('openGlobalShareModal', () => {
  it('shares a form through its own adapter, which knows its access and respond link', async () => {
    const form = {
      type: 'form',
      id: 'form-1',
      name: 'RSVP',
      ownerId: 'macro|owner@example.com',
      access: 'view',
    } as Extract<EntityData, { type: 'form' }>;
    await openGlobalShareModal({ entity: form });
    expect(openFormShareModal).toHaveBeenCalledWith('form-1');
    expect(openShareModal).not.toHaveBeenCalled();
  });

  it('opens the plain share dialog for a document', async () => {
    const document = {
      type: 'document',
      id: 'document-1',
      name: 'Notes',
      ownerId: 'macro|owner@example.com',
      fileType: 'md',
    } as Extract<EntityData, { type: 'document' }>;
    await openGlobalShareModal({ entity: document });
    expect(openFormShareModal).not.toHaveBeenCalled();
    expect(openShareModal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'document-1',
        itemType: 'document',
        name: 'Notes',
        userPermissions: Permissions.OWNER,
      })
    );
  });
});
