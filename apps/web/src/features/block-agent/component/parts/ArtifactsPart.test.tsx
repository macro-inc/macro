/**
 * @vitest-environment jsdom
 *
 * Which element a file gets is the whole component: a recording rendered as
 * an `<img>` shows a broken icon where a walkthrough should be, and a file
 * this browser cannot open at all has to stay reachable as a link.
 */

import type {
  ArtifactItem,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { ArtifactsPart } from './ArtifactsPart';

const item = (overrides: Partial<ArtifactItem>): ArtifactItem => ({
  uri: 'https://macro.com/api/agent-artifacts/a1',
  name: 'settings.png',
  mimeType: 'image/png',
  sizeBytes: 20481,
  ...overrides,
});

const strip = (...items: ArtifactItem[]) => {
  const part: Extract<MessagePart, { kind: 'artifacts' }> = {
    kind: 'artifacts',
    items,
  };
  return render(() => <ArtifactsPart part={part} />).container;
};

describe('a collected file', () => {
  it('shows an image with its name as the alt text', () => {
    const image = strip(item({})).querySelector('img');
    expect(image?.getAttribute('src')).toBe(
      'https://macro.com/api/agent-artifacts/a1'
    );
    expect(image?.getAttribute('alt')).toBe('settings.png');
  });

  it('plays a recording rather than showing it', () => {
    const container = strip(
      item({ name: 'walkthrough.mp4', mimeType: 'video/mp4' })
    );
    expect(container.querySelector('img')).toBeNull();
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe(
      'https://macro.com/api/agent-artifacts/a1'
    );
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.getAttribute('preload')).toBe('metadata');
  });

  it('links anything else, with a size a person can read', () => {
    const container = strip(
      item({
        name: 'trace.zip',
        mimeType: 'application/zip',
        sizeBytes: 1_572_864,
      })
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://macro.com/api/agent-artifacts/a1'
    );
    expect(container.textContent).toContain('trace.zip');
    expect(container.textContent).toContain('1.5 MB');
  });

  it('renders every file in the strip', () => {
    const container = strip(
      item({}),
      item({ name: 'clip.mp4', mimeType: 'video/mp4' })
    );
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelectorAll('video')).toHaveLength(1);
  });
});
