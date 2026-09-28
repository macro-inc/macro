import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadEmailAttachments } from '../context/compose-capabilities';
import { createAttachmentPersistence } from './attachment-persistence';
import { createEmailFormState } from './email-form-state';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function setup(
  uploadAttachments: (input: UploadEmailAttachments) => Promise<void>
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const form = createEmailFormState({
      viewerEmail: () => undefined,
      inboxes: () => [],
    });
    const services = {
      uploadAttachments: vi.fn(uploadAttachments),
      addForwardedAttachments: vi.fn(async () => {}),
      removeAttachment: vi.fn(async () => {}),
      removeForwardedAttachment: vi.fn(async () => {}),
    };
    const [draftId, setDraftId] = createSignal('draft');
    const persistence = createAttachmentPersistence({
      services,
      attachments: form.attachments,
      draftId,
      inboxId: () => 'secondary-inbox',
    });
    return { form, services, persistence, setDraftId };
  });
}

describe('draft attachment persistence', () => {
  it('waits for earlier content uploads even after their attachment IDs are assigned', async () => {
    const { promise: uploadFinished, resolve: finish } =
      Promise.withResolvers<void>();
    const file = new File(['content'], 'notes.txt');
    const state = setup(async (input) => {
      input.onAttachmentAdded?.(file, 'attachment');
      await uploadFinished;
    });
    state.form.attachments.add({ type: 'local', file });
    const first = state.persistence.upload('draft');
    let secondDone = false;
    const second = state.persistence.upload('draft').then(() => {
      secondDone = true;
    });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    expect(state.persistence.uploading()).toBe(true);
    expect(state.services.uploadAttachments).toHaveBeenCalledOnce();
    finish();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
    expect(state.persistence.uploading()).toBe(false);
    expect(state.services.uploadAttachments.mock.calls[0][0].inboxId).toBe(
      'secondary-inbox'
    );
  });

  it('propagates an upload failure and allows a subsequent retry', async () => {
    const file = new File(['content'], 'notes.txt');
    const state = setup(async (input) => {
      input.onAttachmentUploadFailed?.(file);
      throw new Error('Upload failed');
    });
    state.form.attachments.add({ type: 'local', file });
    await expect(state.persistence.upload('draft')).rejects.toThrow(
      'Upload failed'
    );
    expect(state.persistence.uploading()).toBe(false);
    state.services.uploadAttachments.mockImplementationOnce(async (input) => {
      input.onAttachmentAdded?.(file, 'retry-attachment');
    });
    await state.persistence.upload('draft');
    expect(state.form.attachments.list()[0].attachmentId).toBe(
      'retry-attachment'
    );
  });

  it('removes local and forwarded attachments through the appropriate operation', async () => {
    const state = setup(async () => {});
    const local = {
      type: 'local' as const,
      file: new File(['x'], 'notes.txt'),
      attachmentId: 'local',
    };
    const forwarded = {
      type: 'forwarded' as const,
      attachmentId: 'forwarded',
      fileName: 'forward.txt',
      mimeType: 'text/plain',
      fileSize: 1,
    };
    state.form.attachments.add(local);
    state.form.attachments.add(forwarded);
    state.persistence.remove(local);
    state.persistence.remove(forwarded);
    expect(state.form.attachments.list()).toEqual([]);
    expect(state.services.removeAttachment).toHaveBeenCalledWith({
      draftId: 'draft',
      attachmentId: 'local',
      inboxId: 'secondary-inbox',
    });
    expect(state.services.removeForwardedAttachment).toHaveBeenCalledWith({
      draftId: 'draft',
      attachmentId: 'forwarded',
      inboxId: 'secondary-inbox',
    });
    await Promise.resolve();
  });

  it('re-uploads files after detach and ignores late callbacks from the obsolete upload', async () => {
    const pending = Promise.withResolvers<void>();
    const file = new File(['content'], 'notes.txt');
    let oldInput: UploadEmailAttachments | undefined;
    const state = setup(async (input) => {
      input.onAttachmentAdded?.(file, 'replacement-attachment');
    });
    state.services.uploadAttachments.mockImplementationOnce(async (input) => {
      oldInput = input;
      input.onAttachmentAdded?.(file, 'old-attachment');
      await pending.promise;
    });
    state.form.attachments.add({ type: 'local', file });
    const oldUpload = state.persistence.upload('draft');
    state.persistence.detach();
    state.setDraftId('replacement');
    expect(state.form.attachments.list()[0].attachmentId).toBeUndefined();
    const newUpload = state.persistence.upload('replacement');
    oldInput?.onAttachmentAdded?.(file, 'late-old-id');
    oldInput?.onAttachmentUploadFailed?.(file);
    expect(state.form.attachments.list()[0].attachmentId).toBe(
      'replacement-attachment'
    );
    pending.resolve();
    await Promise.all([oldUpload, newUpload]);
    expect(state.services.uploadAttachments).toHaveBeenCalledTimes(2);
    expect(state.form.attachments.list()[0].attachmentId).toBe(
      'replacement-attachment'
    );
  });
});
