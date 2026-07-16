/**
 * @vitest-environment jsdom
 */

import type { Attachment } from '@core/component/AI/types';
import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentList } from './Attachment';

vi.mock('@core/component/ImagePreview', () => ({
  ImagePreview: (props: { image: { id: string } }) => (
    <div data-testid="image-attachment" data-id={props.image.id} />
  ),
}));

describe('AttachmentList', () => {
  it('renders images without duplicating mentioned entities', () => {
    const attachments: Attachment[] = [
      { entity_id: 'image-id', entity_type: 'static_file' },
      { entity_id: 'document-id', entity_type: 'document' },
      { entity_id: 'channel-id', entity_type: 'channel' },
      { entity_id: 'project-id', entity_type: 'project' },
      { entity_id: 'email-id', entity_type: 'email_thread' },
    ];

    const { getAllByTestId } = render(() => (
      <AttachmentList
        attached={() => attachments}
        removeAttachment={vi.fn()}
        uploading={() => []}
      />
    ));

    const rendered = getAllByTestId('image-attachment');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.dataset.id).toBe('image-id');
  });
});
