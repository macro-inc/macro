import type { MessageData } from '@channel/Message';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createMessageEditor } from '../create-message-editor';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('@core/store/cacheChannelInput', () => ({
  STATIC_IMAGE: 'static/image',
  STATIC_VIDEO: 'static/video',
  isStaticAttachmentType: () => false,
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => undefined,
}));

const message: MessageData = {
  id: 'comment',
  parent: { type: 'document', id: 'document' },
  sender_id: 'user',
  content: 'Comment',
  created_at: '2026-09-09T00:00:00Z',
  updated_at: '2026-09-09T00:00:00Z',
  attachments: [],
  reactions: [],
};

describe('message editor lifecycle', () => {
  it('ends the active edit when its thread unmounts', () => {
    const onEditEnded = vi.fn();
    const dispose = createRoot((dispose) => {
      const editor = createMessageEditor({
        parent: () => message.parent!,
        patchMessage: vi.fn(),
        onEditEnded,
      });
      editor.start(message);
      return dispose;
    });
    expect(onEditEnded).not.toHaveBeenCalled();
    dispose();
    expect(onEditEnded).toHaveBeenCalledExactlyOnceWith(message);
  });

  it('does not end an already cancelled edit again on unmount', () => {
    const onEditEnded = vi.fn();
    const dispose = createRoot((dispose) => {
      const editor = createMessageEditor({
        parent: () => message.parent!,
        patchMessage: vi.fn(),
        onEditEnded,
      });
      editor.start(message);
      editor.cancel(message.id);
      return dispose;
    });
    dispose();
    expect(onEditEnded).toHaveBeenCalledExactlyOnceWith(message);
  });
});
