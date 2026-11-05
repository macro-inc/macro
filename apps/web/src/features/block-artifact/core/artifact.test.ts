import { describe, expect, it } from 'vitest';
import { MAX_FRAME_HEIGHT, readFrameMessage } from './frame-message';
import { isOutsideOwnerTeam, sceneSwitcher, selectScene } from './scenes';
import {
  VIEW_URL_MIN_REFRESH_MS,
  VIEW_URL_REFRESH_MARGIN_MS,
  viewUrlRefreshDelay,
} from './view-url';

describe('viewUrlRefreshDelay', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');

  it('refreshes the margin before expiry', () => {
    expect(viewUrlRefreshDelay('2026-11-04T14:00:00Z', now)).toBe(
      2 * 60 * 60 * 1000 - VIEW_URL_REFRESH_MARGIN_MS
    );
  });

  it('waits the minimum for a URL that is already due or expired', () => {
    expect(viewUrlRefreshDelay('2026-11-04T12:01:00Z', now)).toBe(
      VIEW_URL_MIN_REFRESH_MS
    );
    expect(viewUrlRefreshDelay('2026-11-04T11:00:00Z', now)).toBe(
      VIEW_URL_MIN_REFRESH_MS
    );
  });

  it('schedules nothing for an unreadable expiry', () => {
    expect(viewUrlRefreshDelay('soon', now)).toBeUndefined();
  });
});

describe('readFrameMessage', () => {
  const frameWindow = { name: 'artifact frame' };
  const frame = {
    origin: 'https://doc-1.artifacts.macro-agent-gateway.com',
    window: frameWindow,
  };

  it('accepts a size message from the frame and its exact origin', () => {
    expect(
      readFrameMessage(
        {
          origin: 'https://doc-1.artifacts.macro-agent-gateway.com',
          source: frameWindow,
          data: { type: 'macro-artifact:size', height: 412.2 },
        },
        frame
      )
    ).toEqual({ type: 'size', height: 413 });
  });

  it('rejects another origin, even a sibling artifact', () => {
    expect(
      readFrameMessage(
        {
          origin: 'https://doc-2.artifacts.macro-agent-gateway.com',
          source: frameWindow,
          data: { type: 'macro-artifact:size', height: 400 },
        },
        frame
      )
    ).toBeUndefined();
    expect(
      readFrameMessage(
        {
          origin: 'https://doc-1.artifacts.macro-agent-gateway.com.evil.test',
          source: frameWindow,
          data: { type: 'macro-artifact:size', height: 400 },
        },
        frame
      )
    ).toBeUndefined();
  });

  it('rejects the right origin from another window', () => {
    expect(
      readFrameMessage(
        {
          origin: 'https://doc-1.artifacts.macro-agent-gateway.com',
          source: { name: 'popup' },
          data: { type: 'macro-artifact:size', height: 400 },
        },
        frame
      )
    ).toBeUndefined();
  });

  it('rejects everything before the frame has a window', () => {
    expect(
      readFrameMessage(
        {
          origin: 'https://doc-1.artifacts.macro-agent-gateway.com',
          source: undefined,
          data: { type: 'macro-artifact:size', height: 400 },
        },
        { origin: frame.origin, window: undefined }
      )
    ).toBeUndefined();
  });

  it('rejects other message types and bad heights', () => {
    const from = {
      origin: 'https://doc-1.artifacts.macro-agent-gateway.com',
      source: frameWindow,
    };
    expect(
      readFrameMessage(
        { ...from, data: { type: 'macro-artifact:navigate', url: '/' } },
        frame
      )
    ).toBeUndefined();
    expect(
      readFrameMessage(
        { ...from, data: { type: 'macro-artifact:size', height: '400' } },
        frame
      )
    ).toBeUndefined();
    expect(
      readFrameMessage(
        { ...from, data: { type: 'macro-artifact:size', height: -1 } },
        frame
      )
    ).toBeUndefined();
    expect(
      readFrameMessage(
        { ...from, data: { type: 'macro-artifact:size', height: Infinity } },
        frame
      )
    ).toBeUndefined();
    expect(readFrameMessage({ ...from, data: 'size' }, frame)).toBeUndefined();
  });

  it('caps the height', () => {
    expect(
      readFrameMessage(
        {
          origin: 'https://doc-1.artifacts.macro-agent-gateway.com',
          source: frameWindow,
          data: { type: 'macro-artifact:size', height: 1_000_000 },
        },
        frame
      )
    ).toEqual({ type: 'size', height: MAX_FRAME_HEIGHT });
  });
});

describe('selectScene', () => {
  const scenes = [
    { id: 'empty', title: 'Empty', path: 'scenes/empty.html' },
    { id: 'full', title: 'Full', path: 'scenes/full.html' },
  ];

  it('keeps a scene the version has', () => {
    expect(selectScene(scenes, 'full')).toBe('full');
  });

  it('falls back to the index for a missing or unknown scene', () => {
    expect(selectScene(scenes, undefined)).toBeUndefined();
    expect(selectScene(scenes, 'removed')).toBeUndefined();
    expect(selectScene([], 'empty')).toBeUndefined();
  });
});

describe('sceneSwitcher', () => {
  it('uses tabs for a few scenes and a select for many', () => {
    expect(sceneSwitcher(0)).toBe('none');
    expect(sceneSwitcher(6)).toBe('tabs');
    expect(sceneSwitcher(7)).toBe('select');
  });
});

describe('isOutsideOwnerTeam', () => {
  it('trusts the owner and the viewer’s teammates', () => {
    expect(isOutsideOwnerTeam('owner', 'owner', [])).toBe(false);
    expect(isOutsideOwnerTeam('owner', 'viewer', ['viewer', 'owner'])).toBe(
      false
    );
  });

  it('flags anyone else, including signed-out viewers', () => {
    expect(isOutsideOwnerTeam('owner', 'viewer', ['viewer'])).toBe(true);
    expect(isOutsideOwnerTeam('owner', undefined, [])).toBe(true);
  });
});
