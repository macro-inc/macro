/**
 * @vitest-environment jsdom
 *
 * What an attached file renders as is decided by its media type: images and
 * videos as media that open the channel lightbox, everything else as a chip
 * that opens the file.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { fireEvent, render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentPart, attachmentMedium } from './AttachmentPart';

vi.mock('@channel/Media/MediaImage', () => ({
  MediaImage: {
    Root: (props: { children: unknown }) => (
      <div>{props.children as never}</div>
    ),
    Image: (props: { src: string }) => (
      <img data-testid="media-image" src={props.src} alt="" />
    ),
    Fallback: () => null,
  },
}));
vi.mock('@channel/Media/MediaVideo', () => ({
  MediaVideo: {
    Root: (props: { children: unknown }) => (
      <div>{props.children as never}</div>
    ),
    Preview: (props: { src: string }) => (
      <video data-testid="media-video" src={props.src} />
    ),
    PlayOverlay: () => null,
  },
}));
vi.mock('@channel/Media/MediaViewerDialog', () => ({
  MediaViewerDialog: (props: {
    items: () => { id: string; fullSrc: string; kind: string }[];
    open: boolean;
  }) => (
    <div data-open={String(props.open)} data-testid="media-viewer">
      {props.items()[0]?.kind}:{props.items()[0]?.fullSrc}
    </div>
  ),
}));
// The block registry eagerly imports every block's definition, which drags
// the chat input's storage module into jsdom; the extension-to-icon mapping
// is all this component needs from it.
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (fileType?: string) => fileType ?? 'unknown',
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <i data-testid="entity-icon" data-type={props.targetType} />
  ),
}));

type Attachment = Extract<MessagePart, { kind: 'attachment' }>;

const attachment = (over: Partial<Attachment>): Attachment => ({
  kind: 'attachment',
  uri: 'https://static.example/file/1',
  name: 'file.bin',
  mimeType: null,
  size: null,
  ...over,
});

describe('attachmentMedium', () => {
  it('reads the medium off the media type', () => {
    expect(attachmentMedium({ mimeType: 'image/png', name: 'a' })).toBe(
      'image'
    );
    // A wildcard range is what channel attachments carry.
    expect(attachmentMedium({ mimeType: 'video/*', name: 'a' })).toBe('video');
    expect(attachmentMedium({ mimeType: 'application/pdf', name: 'a' })).toBe(
      'file'
    );
    expect(attachmentMedium({ mimeType: null, name: 'notes.txt' })).toBe(
      'file'
    );
  });

  it('falls back to the file name when the sender knew no media type', () => {
    // A browser that reports an empty `type` must not turn the thumbnail the
    // composer showed into a chip once the prompt is sent.
    expect(attachmentMedium({ mimeType: null, name: 'shot.png' })).toBe(
      'image'
    );
    expect(attachmentMedium({ mimeType: null, name: 'clip.mov' })).toBe(
      'video'
    );
    expect(attachmentMedium({ mimeType: null, name: 'README' })).toBe('file');
  });
});

describe('AttachmentPart', () => {
  it('renders an image as a sized thumbnail that opens the media viewer', () => {
    const { getByLabelText, getByTestId, container } = render(() => (
      <AttachmentPart
        part={attachment({ name: 'shot.png', mimeType: 'image/png' })}
      />
    ));
    expect(getByTestId('media-image').getAttribute('src')).toBe(
      'https://static.example/file/1?size=1080'
    );
    expect(container.querySelector('a')).toBeNull();
    expect(getByTestId('media-viewer').getAttribute('data-open')).toBe('false');

    fireEvent.click(getByLabelText('Open image viewer'));
    expect(getByTestId('media-viewer').getAttribute('data-open')).toBe('true');
    expect(getByTestId('media-viewer').textContent).toBe(
      'image:https://static.example/file/1'
    );
  });

  it('renders a video as a preview that opens the media viewer', () => {
    const { getByLabelText, getByTestId, container } = render(() => (
      <AttachmentPart
        part={attachment({ name: 'clip.mp4', mimeType: 'video/mp4' })}
      />
    ));
    expect(getByTestId('media-video').getAttribute('src')).toBe(
      'https://static.example/file/1'
    );
    expect(container.querySelector('a')).toBeNull();
    expect(getByTestId('media-viewer').getAttribute('data-open')).toBe('false');

    fireEvent.click(getByLabelText('Open video viewer'));
    expect(getByTestId('media-viewer').getAttribute('data-open')).toBe('true');
    expect(getByTestId('media-viewer').textContent).toBe(
      'video:https://static.example/file/1'
    );
  });

  it('renders anything else as a named chip that opens the file', () => {
    const { getByTestId, container } = render(() => (
      <AttachmentPart
        part={attachment({ name: 'notes.pdf', mimeType: 'application/pdf' })}
      />
    ));
    expect(container.textContent).toContain('notes.pdf');
    expect(getByTestId('entity-icon').getAttribute('data-type')).toBe('pdf');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://static.example/file/1');
    expect(link?.getAttribute('target')).toBe('_blank');
  });
});
