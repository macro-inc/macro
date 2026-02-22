/**
 * @vitest-environment jsdom
 */

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/ImagePreview', () => ({
  ImagePreview: (props: { image: { id: string } }) => (
    <div data-test-image-preview>{`image:${props.image.id}`}</div>
  ),
}));

vi.mock('@core/component/ImageGalleryPreview', () => ({
  ImageGalleryPreview: (props: { images: { id: string }[] }) => (
    <div data-test-image-gallery>
      {`gallery:${props.images.map((image) => image.id).join(',')}`}
    </div>
  ),
}));

vi.mock('@core/component/VideoPreview', () => ({
  VideoPreview: (props: { id: string }) => (
    <div data-test-video-preview>{`video:${props.id}`}</div>
  ),
}));

vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type?: string }) => (
    <div data-test-item-preview>{`item:${props.id}:${props.type ?? 'unknown'}`}</div>
  ),
}));

vi.mock('@service-storage/client', () => ({
  stringToItemType: (value: string) => value,
}));

import type { MessageData } from '@channel/Message';
import { Attachments, partitionMessageAttachments } from '@channel/Message/Attachments';
import { MessageProvider } from '@channel/Message/context';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';

function createAttachment(
  overrides: Partial<ApiMessageAttachment> = {}
): ApiMessageAttachment {
  return {
    id: `attachment-${Math.random().toString(36).slice(2)}`,
    created_at: '2024-01-01T00:00:00.000Z',
    entity_id: 'entity-1',
    entity_type: 'document',
    ...overrides,
  };
}

function createMessage(overrides: Partial<MessageData> = {}): MessageData {
  return {
    id: 'message-1',
    content: 'message content',
    sender_id: 'user-1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    deleted_at: null,
    edited_at: null,
    attachments: [],
    reactions: [],
    ...overrides,
  };
}

function renderAttachments(message: MessageData) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <MessageProvider value={message}>
        <Attachments />
      </MessageProvider>
    ),
    container
  );

  return {
    container,
    cleanup: () => {
      dispose();
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('partitionMessageAttachments', () => {
  it('matches legacy image/video/document partition behavior', () => {
    const image = createAttachment({
      id: 'att-image',
      entity_id: 'image-1',
      entity_type: 'static/image',
    });
    const video = createAttachment({
      id: 'att-video',
      entity_id: 'video-1',
      entity_type: 'static/video',
    });
    const document = createAttachment({
      id: 'att-doc',
      entity_id: 'doc-1',
      entity_type: 'document',
    });
    const channel = createAttachment({
      id: 'att-channel',
      entity_id: 'channel-1',
      entity_type: 'channel',
    });

    const buckets = partitionMessageAttachments([image, video, document, channel]);

    expect(buckets.imageAttachments.map((attachment) => attachment.id)).toEqual([
      'att-image',
    ]);
    expect(buckets.videoAttachments.map((attachment) => attachment.id)).toEqual([
      'att-video',
    ]);
    expect(
      buckets.documentAttachments.map((attachment) => attachment.id)
    ).toEqual(['att-doc', 'att-channel']);
  });
});

describe('Message.Attachments', () => {
  it('does not render a slot when there are no attachments', () => {
    const { container, cleanup } = renderAttachments(createMessage());

    expect(container.querySelector('[data-message-attachments]')).toBeNull();

    cleanup();
  });

  it('renders a single image preview when there is one static image', () => {
    const { container, cleanup } = renderAttachments(
      createMessage({
        attachments: [
          createAttachment({
            id: 'att-image',
            entity_id: 'image-1',
            entity_type: 'static/image',
          }),
        ],
      })
    );

    expect(container.querySelector('[data-test-image-preview]')?.textContent).toBe(
      'image:image-1'
    );
    expect(container.querySelector('[data-test-image-gallery]')).toBeNull();

    cleanup();
  });

  it('renders mixed attachment previews for image gallery, video, and document', () => {
    const { container, cleanup } = renderAttachments(
      createMessage({
        attachments: [
          createAttachment({
            id: 'att-image-1',
            entity_id: 'image-1',
            entity_type: 'static/image',
          }),
          createAttachment({
            id: 'att-image-2',
            entity_id: 'image-2',
            entity_type: 'static/image',
          }),
          createAttachment({
            id: 'att-video',
            entity_id: 'video-1',
            entity_type: 'static/video',
          }),
          createAttachment({
            id: 'att-doc',
            entity_id: 'doc-1',
            entity_type: 'document',
          }),
        ],
      })
    );

    expect(container.querySelector('[data-test-image-gallery]')?.textContent).toBe(
      'gallery:image-1,image-2'
    );
    expect(container.querySelector('[data-test-video-preview]')?.textContent).toBe(
      'video:video-1'
    );
    expect(container.querySelector('[data-test-item-preview]')?.textContent).toBe(
      'item:doc-1:document'
    );

    cleanup();
  });

  it('does not render attachments when the message is deleted', () => {
    const { container, cleanup } = renderAttachments(
      createMessage({
        deleted_at: '2024-01-01T01:00:00.000Z',
        attachments: [
          createAttachment({
            id: 'att-image',
            entity_id: 'image-1',
            entity_type: 'static/image',
          }),
        ],
      })
    );

    expect(container.querySelector('[data-message-attachments]')).toBeNull();

    cleanup();
  });
});
