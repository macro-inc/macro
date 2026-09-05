import { vi } from 'vitest';
import type { EmailComposeServices } from '../context/compose-services';
/** Fake capabilities: no production modules or app providers are needed by a controller. */
export function composeServices(
  overrides: Partial<EmailComposeServices> = {}
): EmailComposeServices {
  return {
    viewerLoading: () => false,
    onUpgrade: vi.fn(),
    prepareSignatureLinks: vi.fn(),
    readDroppedFiles: vi.fn(),
    feedback: {
      success: vi.fn(),
      failure: vi.fn(),
      alert: vi.fn(),
      dismiss: vi.fn(),
    },
    reportError: vi.fn(),
    isTouch: () => false,
    isMobile: () => false,
    scheduleEnabled: true,
    recipientName: (id) => id,
    recordMention: vi.fn(),
    makePublic: vi.fn(),
    uploadEditorFiles: vi.fn(),
    accounts: {
      inboxes: () => [
        { id: 'inbox', email_address: 'me@example.com', settings: {} },
      ],
      loading: () => false,
      failed: () => false,
      primaryId: () => 'inbox',
      headerId: () => undefined,
    },
    viewerEmail: () => 'me@example.com',
    recipients: () => [],
    signaturesEnabled: () => false,
    hasPaidAccess: () => true,
    saveDraft: vi.fn(async () => ({
      draft: { db_id: 'draft', thread_db_id: 'thread', link_id: 'inbox' },
    })),
    deleteDraft: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => ({
      message: { db_id: 'sent', thread_db_id: 'thread', link_id: 'inbox' },
    })),
    uploadAttachments: vi.fn(async () => {}),
    addForwardedAttachments: vi.fn(async () => {}),
    removeAttachment: vi.fn(async () => {}),
    removeForwardedAttachment: vi.fn(async () => {}),
    unschedule: vi.fn(async () => {}),
    schedule: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    markDraftSaved: vi.fn(),
    prepareUndo: vi.fn(),
    refreshAfterUndo: vi.fn(),
    refreshThreadPreview: vi.fn(),
    invalidatePreview: vi.fn(),
    undoSend: vi.fn(async () => {}),
    restoreDraft: vi.fn(async () => {}),
    ...overrides,
  };
}
