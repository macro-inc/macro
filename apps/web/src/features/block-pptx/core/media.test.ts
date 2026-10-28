import type { SlideOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  formatTime,
  MAX_MEDIA_BYTES,
  mediaBox,
  mediaShapes,
  mediaType,
  mimeOf,
  playableUrl,
} from './media';

describe('media', () => {
  it('types files by extension, then by what the browser says', () => {
    expect(
      mediaType({ name: 'demo.MP4', type: '', size: 10 }, 'video')
    ).toEqual({ type: 'video/mp4' });
    expect(
      mediaType({ name: 'voice.m4a', type: 'audio/x-m4a', size: 10 }, 'audio')
    ).toEqual({ type: 'audio/mp4' });
    expect(
      mediaType({ name: 'song.mp3', type: 'audio/mpeg', size: 10 }, 'video')
    ).toHaveProperty('error');
    expect(
      mediaType({ name: 'notes.txt', type: 'text/plain', size: 10 }, 'audio')
    ).toHaveProperty('error');
    expect(
      mediaType(
        { name: 'big.mp4', type: 'video/mp4', size: MAX_MEDIA_BYTES + 1 },
        'video'
      )
    ).toHaveProperty('error');
    // Shared presentations take small clips only.
    const clip = { name: 'clip.mp4', type: 'video/mp4', size: 3 * 1024 * 1024 };
    expect(mediaType(clip, 'video')).toEqual({ type: 'video/mp4' });
    expect(mediaType(clip, 'video', true)).toEqual({
      error: 'In a shared presentation, clips can be up to 2 MB.',
    });
    expect(mimeOf('/ppt/media/media3.mov')).toBe('video/quicktime');
    expect(mimeOf('/ppt/media/media1.bin')).toBe('application/octet-stream');
  });

  it('fits and centers new clips', () => {
    expect(mediaBox({ w: 1920, h: 1080 }, { w: 960, h: 540 })).toEqual({
      x: 192,
      y: 108,
      w: 576,
      h: 324,
    });
    expect(mediaBox({ w: 48, h: 48 }, { w: 960, h: 540 })).toEqual({
      x: 456,
      y: 246,
      w: 48,
      h: 48,
    });
  });

  it('plays linked clips only from https', () => {
    expect(playableUrl(' https://cdn.example.com/a.mp4 ')).toBe(
      'https://cdn.example.com/a.mp4'
    );
    expect(playableUrl('http://example.com/a.mp4')).toBeUndefined();
    expect(playableUrl('file:///C:/clip.wmv')).toBeUndefined();
  });

  it('finds visible media shapes, groups searched', () => {
    const slide = {
      shapes: [
        { id: 2, media: { kind: 'video', part: '/ppt/media/media1.mp4' } },
        { id: 3, hidden: true, media: { kind: 'audio' } },
        {
          id: 4,
          children: [{ id: 5, media: { kind: 'audio', part: 'x.mp3' } }],
        },
      ],
    } as unknown as SlideOutline;
    expect(mediaShapes(slide).map((m) => m.shape.id)).toEqual([2, 5]);
  });

  it('formats playback time', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.9)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});
