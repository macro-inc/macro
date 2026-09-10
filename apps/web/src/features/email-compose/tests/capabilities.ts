import { vi } from 'vitest';
import type { EmailComposeContext } from '../context/compose-capabilities';
/** Fake capabilities: no production modules or app providers are needed by a controller. */
export function createComposeContext(): EmailComposeContext {
  return {
    recipientName: (id) => id,
    recordMention: vi.fn(),
    accounts: {
      inboxes: () => [
        { id: 'inbox', email_address: 'me@example.com', settings: {} },
      ],
      loading: () => false,
      failed: () => false,
      primaryId: () => 'inbox',
    },
    viewerEmail: () => 'me@example.com',
    recipients: () => [],
    hasPaidAccess: () => true,
    presentation: {
      viewerLoading: () => false,
      onUpgrade: vi.fn(),
      prepareSignatureLinks: vi.fn(),
      isTouch: () => false,
      isMobile: () => false,
      scheduleEnabled: true,
      signaturesEnabled: () => false,
    },
    editorFiles: {
      readDroppedFiles: vi.fn(),
      makePublic: vi.fn(),
      uploadEditorFiles: vi.fn(),
    },
    notices: {
      feedback: {
        success: vi.fn(),
        failure: vi.fn(),
        alert: vi.fn(),
        dismiss: vi.fn(),
      },
      reportError: vi.fn(),
    },
    drafts: {
      saveDraft: vi.fn(async () => ({
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
      })),
      deleteDraft: vi.fn(async () => {}),
      restoreDraft: vi.fn(async () => {}),
    },
    delivery: {
      sendMessage: vi.fn(async () => ({
        draftId: 'sent',
        threadId: 'thread',
        inboxId: 'inbox',
      })),
      unschedule: vi.fn(async () => {}),
      schedule: vi.fn(async () => {}),
      archive: vi.fn(async () => {}),
      undoSend: vi.fn(async () => {}),
    },
    attachmentStorage: {
      uploadAttachments: vi.fn(async () => {}),
      addForwardedAttachments: vi.fn(async () => {}),
      removeAttachment: vi.fn(async () => {}),
      removeForwardedAttachment: vi.fn(async () => {}),
    },
  };
}
