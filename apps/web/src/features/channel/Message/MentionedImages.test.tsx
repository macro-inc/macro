import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Preview =
  | { loading: true; id: string; type: 'document' }
  | {
      loading: false;
      access: 'access';
      id: string;
      type: 'document' | 'channel';
      name: string;
      fileType?: string;
    }
  | { loading: false; access: 'no_access'; id: string; type: 'document' };

const fixture = vi.hoisted(() => ({
  previews: new Map<string, () => Preview>(),
  requested: [] as { id: string; type?: string }[],
}));

vi.mock('@queries/preview', () => ({
  useItemPreview: (entity: () => { id: string; type?: string }) => {
    fixture.requested.push(entity());
    return [
      () =>
        fixture.previews.get(entity().id)?.() ?? {
          loading: true,
          id: entity().id,
          type: 'document',
        },
    ];
  },
  isAccessiblePreviewItem: (item: { loading: boolean; access?: string }) =>
    !item.loading && item.access === 'access',
}));

vi.mock('@core/constant/allBlocks', () => ({
  verifyBlockName: (name?: string) => name ?? 'unknown',
  fileTypeToResolvedBlockName: (fileType?: string) =>
    fileType === 'png' || fileType === 'jpg' ? 'image' : 'unknown',
}));

vi.mock('@service-storage/itemType', () => ({
  blockNameToItemType: (blockName: string) =>
    blockName === 'channel' || blockName === 'chat' ? blockName : 'document',
}));

vi.mock('@core/component/ImageDocumentCard', () => ({
  ImageDocumentCard: (props: { documentId: string; fileName: string }) => (
    <figure data-document-id={props.documentId}>{props.fileName}</figure>
  ),
}));

import { MentionedImages } from './MentionedImages';

const mention = (documentId: string, blockName = 'md') =>
  `<m-document-mention>${JSON.stringify({
    documentId,
    documentName: '',
    blockName,
    blockParams: {},
  })}</m-document-mention>`;

function accessible(
  id: string,
  name: string,
  fileType?: string,
  type: 'document' | 'channel' = 'document'
): Preview {
  return { loading: false, access: 'access', id, type, name, fileType };
}

afterEach(cleanup);
beforeEach(() => {
  fixture.previews.clear();
  fixture.requested = [];
});

describe('MentionedImages', () => {
  it('shows an image card for each mentioned image document', () => {
    fixture.previews.set('frog', () => accessible('frog', 'frog.png', 'png'));
    fixture.previews.set('notes', () => accessible('notes', 'Notes', 'md'));
    const view = render(() => (
      <MentionedImages
        content={`here ${mention('frog', 'md')} and ${mention('notes')}`}
      />
    ));
    const cards = view.getAllByRole('figure');
    expect(cards.map((card) => card.getAttribute('data-document-id'))).toEqual([
      'frog',
    ]);
    expect(cards[0].textContent).toBe('frog.png');
  });

  it('relies on the resolved file type, not the block name the author wrote', () => {
    fixture.previews.set('frog', () => accessible('frog', 'frog.jpg', 'jpg'));
    const view = render(() => (
      <MentionedImages content={mention('frog', 'image')} />
    ));
    expect(view.getByRole('figure').textContent).toBe('frog.jpg');
  });

  it('never looks up channels or chats as documents', () => {
    fixture.previews.set('general', () =>
      accessible('general', 'general', undefined, 'channel')
    );
    const view = render(() => (
      <MentionedImages
        content={`${mention('general', 'channel')} ${mention('c1', 'chat')}`}
      />
    ));
    expect(view.queryByRole('figure')).toBeNull();
    expect(fixture.requested).toEqual([]);
    expect(
      view.container.querySelector('[data-message-mentioned-images]')
    ).toBeNull();
  });

  it('renders nothing for inaccessible or pending documents', () => {
    fixture.previews.set('secret', () => ({
      loading: false,
      access: 'no_access',
      id: 'secret',
      type: 'document',
    }));
    const view = render(() => (
      <MentionedImages
        content={`${mention('secret', 'image')} ${mention('pending', 'image')}`}
      />
    ));
    expect(view.queryByRole('figure')).toBeNull();
    expect(fixture.requested.map((entity) => entity.type)).toEqual([
      'document',
      'document',
    ]);
  });

  it('shows one card when the same image is mentioned twice', () => {
    fixture.previews.set('frog', () => accessible('frog', 'frog.png', 'png'));
    const view = render(() => (
      <MentionedImages
        content={`${mention('frog', 'md')} again ${mention('frog', 'image')}`}
      />
    ));
    expect(view.getAllByRole('figure')).toHaveLength(1);
  });

  it('appears once the preview resolves to an image', () => {
    const [preview, setPreview] = createSignal<Preview>({
      loading: true,
      id: 'frog',
      type: 'document',
    });
    fixture.previews.set('frog', preview);
    const view = render(() => (
      <MentionedImages content={mention('frog', 'image')} />
    ));
    expect(view.queryByRole('figure')).toBeNull();
    setPreview(accessible('frog', 'frog.png', 'png'));
    expect(view.getByRole('figure').textContent).toBe('frog.png');
  });
});
