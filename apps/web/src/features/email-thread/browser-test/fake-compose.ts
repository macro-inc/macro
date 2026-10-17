import type { EmailComposeContext } from '../../email-compose/context/compose-capabilities';
import { decodeBase64Utf8 } from '../../email-compose/core/decode-base64';

/** An in-memory compose backend that reports draft writes instead of persisting them. */
export function createFakeCompose(record: {
  saved(body: string): void;
  deleted(draftId: string): void;
}): EmailComposeContext {
  const identity = { draftId: 'draft', threadId: 'thread', inboxId: 'inbox' };
  return {
    drafts: {
      async saveDraft(input) {
        record.saved(decodeBase64Utf8(input.draft.body_html ?? ''));
        return identity;
      },
      async deleteDraft(input) {
        record.deleted(input.draftId);
      },
      async restoreDraft() {},
    },
    delivery: {
      async sendMessage() {
        return identity;
      },
      async unschedule() {},
      async schedule() {},
      async archive() {},
      async undoSend() {},
    },
    attachmentStorage: {
      async uploadAttachments() {},
      async addForwardedAttachments() {},
      async removeAttachment() {},
      async removeForwardedAttachment() {},
    },
    draftLifecycle: {
      observe: () => ({
        state: () => undefined,
        refresh: async () => undefined,
      }),
    },
    notices: {
      feedback: {
        success: () => undefined,
        failure: () => undefined,
        alert() {},
        dismiss() {},
      },
      async blockingNotice() {},
      reportError(error) {
        console.error(error);
      },
    },
    accounts: {
      inboxes: () => [
        { id: 'inbox', email_address: 'viewer@example.com', settings: {} },
      ],
      loading: () => false,
      failed: () => false,
      primaryId: () => 'inbox',
    },
    connectivity: { looksOffline: () => false },
    presentation: {
      viewerLoading: () => false,
      onUpgrade() {},
      prepareSignatureLinks() {},
      isTouch: () => false,
      isMobile: () => false,
      scheduleEnabled: true,
      signaturesEnabled: () => false,
    },
    editorFiles: {
      readDroppedFiles() {},
      makePublic() {},
      uploadEditorFiles() {},
    },
    viewerEmail: () => 'viewer@example.com',
    recipients: () => [],
    recipientName: (id) => id,
    hasPaidAccess: () => true,
    recordMention() {},
  };
}
