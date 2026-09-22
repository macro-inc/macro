import { describe, expect, it, vi } from 'vitest';
import type { DraftIdentity } from './draft-session';
import type { DraftFormAttachment } from './email-form-state';
import {
  refuseSend,
  sendRefusalAfterSave,
  sendRefusalBeforeSave,
} from './send-readiness';

const server: DraftIdentity = { kind: 'server', draftId: 's-1', queued: false };
const handle: DraftIdentity = { kind: 'handle', draftId: 'h-1', queued: false };

const uploaded = {
  type: 'local',
  attachmentId: 'a-1',
} as unknown as DraftFormAttachment;
const pending = { type: 'local' } as unknown as DraftFormAttachment;

const ready = {
  identity: server,
  autosaveAllowed: true,
  attachments: [uploaded],
  unqueuedHandleMaySend: false,
};

describe('sendRefusalBeforeSave', () => {
  it('refuses only while the device looks offline', () => {
    expect(sendRefusalBeforeSave({ looksOffline: () => true })).toBe('offline');
    expect(
      sendRefusalBeforeSave({ looksOffline: () => false })
    ).toBeUndefined();
  });
});

describe('sendRefusalAfterSave', () => {
  it('allows a confirmed server draft with uploaded attachments', () => {
    expect(sendRefusalAfterSave(ready)).toBeUndefined();
  });

  it('refuses while autosave is latched, whatever the identity', () => {
    expect(sendRefusalAfterSave({ ...ready, autosaveAllowed: false })).toBe(
      'draft-not-confirmed'
    );
    expect(
      sendRefusalAfterSave({
        ...ready,
        identity: handle,
        autosaveAllowed: false,
        unqueuedHandleMaySend: true,
      })
    ).toBe('draft-not-confirmed');
  });

  it('refuses a server draft whose latest save is still queued', () => {
    expect(
      sendRefusalAfterSave({ ...ready, identity: { ...server, queued: true } })
    ).toBe('draft-not-confirmed');
  });

  it('refuses a queued handle, and an unqueued one unless the surface allows it', () => {
    expect(sendRefusalAfterSave({ ...ready, identity: handle })).toBe(
      'draft-not-confirmed'
    );
    expect(
      sendRefusalAfterSave({
        ...ready,
        identity: handle,
        unqueuedHandleMaySend: true,
      })
    ).toBeUndefined();
    expect(
      sendRefusalAfterSave({
        ...ready,
        identity: { ...handle, queued: true },
        unqueuedHandleMaySend: true,
      })
    ).toBe('draft-not-confirmed');
  });

  it('refuses when a local attachment never received a record', () => {
    expect(
      sendRefusalAfterSave({ ...ready, attachments: [uploaded, pending] })
    ).toBe('attachment-not-uploaded');
  });

  it('checks identity before attachments', () => {
    expect(
      sendRefusalAfterSave({
        ...ready,
        identity: { ...server, queued: true },
        attachments: [pending],
      })
    ).toBe('draft-not-confirmed');
  });
});

describe('refuseSend', () => {
  it('shows one failure notice with the reason as subtext', () => {
    const failure = vi.fn();
    refuseSend(
      {
        feedback: {
          success: vi.fn(),
          failure,
          alert: vi.fn(),
          dismiss: vi.fn(),
        },
        blockingNotice: vi.fn(),
        reportError: vi.fn(),
      },
      'attachment-not-uploaded'
    );
    expect(failure).toHaveBeenCalledWith('Failed to send email', {
      subtext: 'Attachment not uploaded',
    });
  });
});
