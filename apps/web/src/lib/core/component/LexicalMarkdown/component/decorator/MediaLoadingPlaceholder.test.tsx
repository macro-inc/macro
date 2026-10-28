/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import {
  MediaLoadingPlaceholder,
  mediaFileNameFromUrl,
} from './MediaLoadingPlaceholder';

describe('MediaLoadingPlaceholder', () => {
  it('reserves a 16:9 card and names the file that is still loading', () => {
    render(() => (
      <MediaLoadingPlaceholder kind="image" label="walkthrough.png" />
    ));
    const card = screen.getByRole('status', {
      name: 'Loading walkthrough.png',
    });
    expect(card.getAttribute('data-media-loading')).toBe('image');
    expect(card.className).toContain('aspect-video');
    expect(screen.getByText('walkthrough.png')).toBeTruthy();
  });

  it('falls back to Image or Video when the file has no name', () => {
    const view = render(() => <MediaLoadingPlaceholder kind="video" />);
    expect(screen.getByRole('status', { name: 'Loading Video' })).toBeTruthy();
    expect(screen.getByText('Video')).toBeTruthy();

    view.unmount();
    render(() => <MediaLoadingPlaceholder kind="image" label="  " />);
    expect(screen.getByRole('status', { name: 'Loading Image' })).toBeTruthy();
  });
});

describe('mediaFileNameFromUrl', () => {
  it('keeps a file name and drops opaque ids', () => {
    expect(
      mediaFileNameFromUrl('https://files.macro.com/walkthrough.mp4')
    ).toBe('walkthrough.mp4');
    expect(
      mediaFileNameFromUrl(
        'https://static-file-service-dev.macro.com/file/499fcf96-b38f-4660-9994-8b6a7da58f13'
      )
    ).toBeUndefined();
    expect(mediaFileNameFromUrl('not a url')).toBeUndefined();
  });
});
