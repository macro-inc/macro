/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

const mediaPlugin = vi.hoisted(() => ({
  $upgradeDSSMediaUrl: vi.fn(),
  getMediaUrl: vi.fn(),
  ON_MEDIA_COMPONENT_MOUNT_COMMAND: 'ON_MEDIA_COMPONENT_MOUNT_COMMAND',
  UPDATE_MEDIA_SIZE_COMMAND: 'UPDATE_MEDIA_SIZE_COMMAND',
  UPLOAD_MEDIA_FAILURE_COMMAND: 'UPLOAD_MEDIA_FAILURE_COMMAND',
  UPLOAD_MEDIA_START_COMMAND: 'UPLOAD_MEDIA_START_COMMAND',
  UPLOAD_MEDIA_SUCCESS_COMMAND: 'UPLOAD_MEDIA_SUCCESS_COMMAND',
}));
vi.mock('../../plugins/media', () => mediaPlugin);
vi.mock('../../plugins', () => mediaPlugin);
vi.mock('@core/component/Lightbox', () => ({
  Lightbox: () => null,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

import { MarkdownImage } from './MarkdownImage';
import { MarkdownVideo } from './MarkdownVideo';

const unsetMedia = {
  srcType: 'url',
  id: '',
  width: 0,
  height: 0,
  scale: 1,
} as const;

describe('markdown media loading', () => {
  it('shows a reserved image card while the file has no size yet', () => {
    render(() => (
      <MarkdownImage
        {...unsetMedia}
        key="image"
        url="https://files.macro.com/walkthrough.png"
        alt="walkthrough.png"
      />
    ));
    const card = screen.getByRole('status', {
      name: 'Loading walkthrough.png',
    });
    expect(card.getAttribute('data-media-loading')).toBe('image');
    expect(card.className).toContain('aspect-video');
  });

  it('keeps known dimensions on load and failure, including short images', () => {
    const view = render(() => (
      <MarkdownImage
        {...unsetMedia}
        key="known-image"
        url="https://files.macro.com/banner.png"
        alt="banner"
        width={2048}
        height={512}
        constrainedWidth={400}
        constrainedHeight={400}
      />
    ));
    const image = view.container.querySelector('img')!;
    const frame = image.parentElement!;
    expect(frame.style.aspectRatio).toBe('4');
    expect(frame.style.width).toBe('100%');
    expect(frame.style.maxWidth).toBe('400px');
    expect(image.classList.contains('absolute')).toBe(true);
    const initialStyle = frame.getAttribute('style');
    Object.defineProperties(image, {
      naturalWidth: { value: 2048 },
      naturalHeight: { value: 512 },
    });
    fireEvent.load(image);
    expect(frame.getAttribute('style')).toBe(initialStyle);
    fireEvent.error(image);
    expect(frame.getAttribute('style')).toBe(initialStyle);
    expect(frame.classList.contains('min-h-44')).toBe(false);
    expect(view.getByText('This image could not be found.')).toBeTruthy();
  });

  it('shows a reserved video card named from the url', () => {
    render(() => (
      <MarkdownVideo
        {...unsetMedia}
        key="video"
        url="https://files.macro.com/agents_list.mp4"
        controls
      />
    ));
    const card = screen.getByRole('status', {
      name: 'Loading agents_list.mp4',
    });
    expect(card.getAttribute('data-media-loading')).toBe('video');
    expect(card.className).toContain('aspect-video');
    // Unknown size used to set max-height: 0, which clipped the card.
    expect(card.parentElement?.style.maxHeight).toBe('');
  });
});

describe('markdown image viewer', () => {
  // The viewer's own content comes from the mocked Lightbox, so the open state
  // is observed through the dialog overlay.
  const viewerOpen = () => !!document.querySelector('.scrim-glass');

  it('opens the viewer on a single click when there is no editable editor', () => {
    render(() => (
      <MarkdownImage
        {...unsetMedia}
        key="image"
        url="https://files.macro.com/walkthrough.png"
        alt="walkthrough.png"
      />
    ));

    const image = document.querySelector('img');
    if (!image) throw new Error('image not rendered');
    // jsdom never loads the file; the decorator keys "ok" off this event.
    image.dispatchEvent(new Event('load'));
    expect(viewerOpen()).toBe(false);

    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(viewerOpen()).toBe(true);
  });
});
