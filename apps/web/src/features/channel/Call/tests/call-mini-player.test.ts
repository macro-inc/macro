import { describe, expect, it } from 'vitest';
import {
  constrainCallPlayerPosition,
  nearestCallPlayerCorner,
  resizeCallPlayer,
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
  it('keeps opposite sides fixed and video at 16:9 on every resize edge', () => {
    const box = { x: 800, y: 500, width: 336, height: 310 };
    for (const edge of [
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ] as const) {
      const result = resizeCallPlayer(
        edge,
        box,
        180,
        -30,
        -20,
        1440,
        900,
        false,
        'bottom-right'
      );
      expect(result.mediaHeight).toBeCloseTo(((result.width - 16) * 9) / 16);
      expect(result.x).toBeGreaterThanOrEqual(12);
      expect(result.y).toBeGreaterThanOrEqual(12);
      expect(result.x + result.width).toBeLessThanOrEqual(1428);
      expect(result.y + result.mediaHeight + 130).toBeLessThanOrEqual(888);
      if (edge.includes('left') || edge === 'top' || edge === 'bottom') {
        expect(result.x + result.width).toBe(box.x + box.width);
      } else {
        expect(result.x).toBe(box.x);
      }
      if (edge.includes('top') || edge === 'left' || edge === 'right') {
        expect(result.y + result.mediaHeight + 130).toBeCloseTo(
          box.y + box.height
        );
      } else {
        expect(result.y).toBe(box.y);
      }
    }
  });

  it('clamps video to viewport limits and audio to a 144px minimum', () => {
    const box = { x: 20, y: 20, width: 336, height: 310 };
    const video = resizeCallPlayer(
      'bottom-right',
      box,
      180,
      1000,
      1000,
      480,
      420,
      false,
      'top-left'
    );
    expect(video.x + video.width).toBeLessThanOrEqual(468);
    expect(video.y + video.mediaHeight + 130).toBeLessThanOrEqual(408);
    const audio = resizeCallPlayer(
      'top-left',
      { x: 400, y: 300, width: 336, height: 274 },
      144,
      500,
      500,
      1440,
      900,
      true,
      'bottom-right'
    );
    expect(audio.mediaHeight).toBe(144);
    expect(audio.width).toBe(256);
    expect(audio.x + audio.width).toBe(736);
    expect(audio.y + audio.mediaHeight + 130).toBe(574);
    const grown = resizeCallPlayer(
      'bottom',
      { x: 400, y: 300, width: 336, height: 274 },
      144,
      0,
      75,
      1440,
      900,
      true,
      'top-left'
    );
    expect(grown.mediaHeight).toBe(219);
    expect(grown.y).toBe(300);
  });
  it('keeps a resized left edge inside the viewport without moving its right edge', () => {
    const result = resizeCallPlayer(
      'left',
      { x: 1080, y: 300, width: 336, height: 310 },
      180,
      -1000,
      0,
      1440,
      900,
      false,
      'bottom-right'
    );
    expect(result.width).toBe(640);
    expect(result.x).toBe(776);
    expect(result.x + result.width).toBe(1416);
    expect(result.y + result.mediaHeight + 130).toBeCloseTo(610);
  });
  it('reclamps the player when camera media grows after an audio-only resize', () => {
    expect(constrainCallPlayerPosition(1000, 600, 400, 346, 1440, 900)).toEqual(
      {
        x: 1000,
        y: 542,
      }
    );
  });
});
