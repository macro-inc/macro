import { describe, expect, it } from 'vitest';
import {
  constrainCallPlayerPosition,
  nearestCallPlayerCorner,
  selectCallPreview,
} from '../call-mini-player';

describe('call mini player', () => {
  it('prioritizes a screen, then speaking, then video', () => {
    const camera = {
      id: 'camera',
      hasVideo: true,
      sharing: false,
      speaking: false,
    };
    const speaker = {
      id: 'speaker',
      hasVideo: false,
      sharing: false,
      speaking: true,
    };
    const screen = {
      id: 'screen',
      hasVideo: false,
      sharing: true,
      speaking: false,
    };
    expect(selectCallPreview([camera, speaker, screen])).toBe(screen);
    expect(selectCallPreview([camera, speaker])).toBe(speaker);
    expect(selectCallPreview([camera])).toBe(camera);
    expect(selectCallPreview([])).toBeUndefined();
  });
  it('snaps using the player center and keeps dragging within the viewport', () => {
    expect(nearestCallPlayerCorner(40, 30, 336, 240, 1440, 900)).toBe(
      'top-left'
    );
    expect(nearestCallPlayerCorner(1000, 600, 336, 240, 1440, 900)).toBe(
      'bottom-right'
    );
    expect(constrainCallPlayerPosition(-50, 900, 336, 240, 1440, 900)).toEqual({
      x: 12,
      y: 648,
    });
  });
});
