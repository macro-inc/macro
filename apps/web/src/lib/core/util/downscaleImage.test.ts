/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canDownscaleImageType,
  downscaleImageForUpload,
  exceedsUploadLimits,
  fitWithinEdge,
} from './downscaleImage';

// Tiny limits keep the fake files small; the logic only compares numbers.
const options = { maxEdge: 100, maxBytes: 1000 };

/** Every canvas size that was encoded, in order. */
const encoded: { width: number; height: number; type: string | undefined }[] =
  [];
/** Simulated compression: bytes the fake encoder produces per pixel. */
let bytesPerPixel = 0.05;
/** The type the fake encoder actually produces for a requested type. */
let encoderOutput = (requested: string | undefined) => requested ?? 'image/png';

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

function stubBitmap(width: number, height: number) {
  const close = vi.fn();
  const createImageBitmap = vi.fn(async () => ({ width, height, close }));
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  return { close, createImageBitmap };
}

function imageFile(size: number, type: string, name = 'photo.jpg') {
  return new File([new Uint8Array(size)], name, { type });
}

beforeEach(() => {
  encoded.length = 0;
  bytesPerPixel = 0.05;
  encoderOutput = (requested) => requested ?? 'image/png';
  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage: vi.fn(),
    imageSmoothingQuality: 'low',
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = function (callback, type) {
    encoded.push({ width: this.width, height: this.height, type });
    const size = Math.ceil(this.width * this.height * bytesPerPixel);
    callback(new Blob([new Uint8Array(size)], { type: encoderOutput(type) }));
  };
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  vi.unstubAllGlobals();
});

describe('fitWithinEdge', () => {
  it('never upscales', () => {
    expect(fitWithinEdge({ width: 80, height: 60 }, 100)).toEqual({
      width: 80,
      height: 60,
    });
  });

  it('scales the longest edge down and keeps the aspect ratio', () => {
    expect(fitWithinEdge({ width: 4000, height: 3000 }, 100)).toEqual({
      width: 100,
      height: 75,
    });
    expect(fitWithinEdge({ width: 300, height: 400 }, 100)).toEqual({
      width: 75,
      height: 100,
    });
  });

  it('keeps extreme aspect ratios at least one pixel wide', () => {
    expect(fitWithinEdge({ width: 10_000, height: 1 }, 100)).toEqual({
      width: 100,
      height: 1,
    });
  });
});

describe('exceedsUploadLimits', () => {
  it('flags an image over the byte budget or over the edge limit', () => {
    const fits = { width: 100, height: 100 };
    expect(exceedsUploadLimits({ size: 1000 }, fits, options)).toBe(false);
    expect(exceedsUploadLimits({ size: 1001 }, fits, options)).toBe(true);
    expect(
      exceedsUploadLimits({ size: 10 }, { width: 101, height: 10 }, options)
    ).toBe(true);
    expect(
      exceedsUploadLimits({ size: 10 }, { width: 10, height: 101 }, options)
    ).toBe(true);
  });
});

describe('canDownscaleImageType', () => {
  it('accepts raster images and rejects animation, vectors, and non-images', () => {
    expect(canDownscaleImageType('image/jpeg')).toBe(true);
    expect(canDownscaleImageType('image/png')).toBe(true);
    expect(canDownscaleImageType('image/heic')).toBe(true);
    expect(canDownscaleImageType('image/gif')).toBe(false);
    expect(canDownscaleImageType('image/svg+xml')).toBe(false);
    expect(canDownscaleImageType('application/pdf')).toBe(false);
    expect(canDownscaleImageType('')).toBe(false);
  });
});

describe('downscaleImageForUpload', () => {
  it('returns an image that already fits untouched', async () => {
    const { close } = stubBitmap(80, 60);
    const file = imageFile(500, 'image/jpeg');

    const result = await downscaleImageForUpload(file, options);

    expect(result).toBe(file);
    expect(encoded).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('scales an oversized image to fit the longest edge, keeping the aspect ratio', async () => {
    const { close } = stubBitmap(4000, 3000);
    const file = imageFile(500, 'image/jpeg');

    const result = await downscaleImageForUpload(file, options);

    expect(encoded).toEqual([{ width: 100, height: 75, type: 'image/jpeg' }]);
    expect(result).not.toBe(file);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('photo.jpg');
    expect(result.size).toBeLessThanOrEqual(options.maxBytes);
    expect(close).toHaveBeenCalledOnce();
  });

  it('re-encodes at the same size when only the byte size is over budget', async () => {
    stubBitmap(80, 60);
    const file = imageFile(5000, 'image/jpeg');

    const result = await downscaleImageForUpload(file, options);

    expect(encoded).toEqual([{ width: 80, height: 60, type: 'image/jpeg' }]);
    expect(result.size).toBeLessThanOrEqual(options.maxBytes);
  });

  it('shrinks further until the encoded result fits the byte budget', async () => {
    stubBitmap(4000, 3000);
    // 100x75 encodes to 1500 bytes, one shrink step (75x56) to 840.
    bytesPerPixel = 0.2;

    const result = await downscaleImageForUpload(
      imageFile(500, 'image/jpeg'),
      options
    );

    expect(encoded.map(({ width, height }) => [width, height])).toEqual([
      [100, 75],
      [75, 56],
    ]);
    expect(result.size).toBe(840);
  });

  it('stops after a bounded number of attempts and lets the caller reject the result', async () => {
    stubBitmap(4000, 3000);
    bytesPerPixel = 1000;

    const result = await downscaleImageForUpload(
      imageFile(500, 'image/jpeg'),
      options
    );

    expect(encoded).toHaveLength(5);
    expect(result.size).toBeGreaterThan(options.maxBytes);
  });

  it('keeps PNG lossless so transparency survives', async () => {
    stubBitmap(4000, 3000);

    const result = await downscaleImageForUpload(
      imageFile(500, 'image/png', 'logo.png'),
      options
    );

    expect(encoded[0]?.type).toBe('image/png');
    expect(result.type).toBe('image/png');
    expect(result.name).toBe('logo.png');
  });

  it('re-encodes photo formats without a canvas encoder as JPEG and renames the file', async () => {
    stubBitmap(4000, 3000);

    const result = await downscaleImageForUpload(
      imageFile(500, 'image/heic', 'IMG_0001.HEIC'),
      options
    );

    expect(encoded[0]?.type).toBe('image/jpeg');
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('IMG_0001.jpg');
  });

  it('names the file after what the browser actually encoded', async () => {
    stubBitmap(4000, 3000);
    // Safari has no WebP encoder and hands back PNG instead.
    encoderOutput = () => 'image/png';

    const result = await downscaleImageForUpload(
      imageFile(500, 'image/webp', 'photo.webp'),
      options
    );

    expect(encoded[0]?.type).toBe('image/webp');
    expect(result.type).toBe('image/png');
    expect(result.name).toBe('photo.png');
  });

  it('leaves GIFs and SVGs alone without decoding them', async () => {
    const { createImageBitmap } = stubBitmap(4000, 3000);
    const gif = imageFile(5000, 'image/gif', 'party.gif');
    const svg = imageFile(5000, 'image/svg+xml', 'logo.svg');

    expect(await downscaleImageForUpload(gif, options)).toBe(gif);
    expect(await downscaleImageForUpload(svg, options)).toBe(svg);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('uploads the original when the browser cannot decode it', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('unsupported', 'InvalidStateError');
      })
    );
    const file = imageFile(5000, 'image/heic', 'IMG_0001.HEIC');

    expect(await downscaleImageForUpload(file, options)).toBe(file);
    expect(encoded).toEqual([]);
  });

  it('uploads the original when the browser has no createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const file = imageFile(5000, 'image/jpeg');

    expect(await downscaleImageForUpload(file, options)).toBe(file);
  });

  it('uploads the original when the canvas cannot encode', async () => {
    const { close } = stubBitmap(4000, 3000);
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = imageFile(5000, 'image/jpeg');

    expect(await downscaleImageForUpload(file, options)).toBe(file);
    expect(warn).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
