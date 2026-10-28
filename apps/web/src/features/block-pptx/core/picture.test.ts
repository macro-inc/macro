import type { ShapeOutline } from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  adjustPixels,
  aspectCrop,
  CORRECTION_STEPS,
  correctionKey,
  cropChanged,
  cropEdges,
  cropOps,
  cropState,
  dragCropHandle,
  localToSlide,
  NO_CROP,
  panCrop,
  pictureImagePart,
  RECOLOR_ROWS,
  recolorKey,
  resolveRecolor,
  scaleCropImage,
  slideDeltaToLocal,
} from './picture';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

const picture = (box: Partial<ShapeOutline>): ShapeOutline => ({
  id: 5,
  name: 'Picture',
  kind: 'picture',
  x: 100,
  y: 50,
  w: 100,
  h: 80,
  rotation: 0,
  flipH: false,
  flipV: false,
  hidden: false,
  textEditable: false,
  picture: {
    crop: NO_CROP,
    brightness: 0,
    contrast: 0,
    recolor: 'none',
    transparency: 0,
  },
  ...box,
});

describe('crop state', () => {
  it('finds the whole image from the frame and crop', () => {
    const s = cropState(60, 80, {
      left: 0.25,
      top: 0,
      right: 0.15,
      bottom: 0.2,
    });
    close(s.image.w, 100);
    close(s.image.h, 100);
    close(s.image.x, -25);
    close(s.image.y, 0);
    const edges = cropEdges(s);
    close(edges.left, 0.25);
    close(edges.right, 0.15);
    close(edges.bottom, 0.2);
  });

  it('crops an edge by dragging its handle inward', () => {
    const start = cropState(100, 80, NO_CROP);
    const s = dragCropHandle(start, 'e', { x: -20, y: 5 });
    expect(s.frame).toEqual({ x: 0, y: 0, w: 80, h: 80 });
    expect(s.image).toEqual(start.image);
    const edges = cropEdges(s);
    close(edges.right, 0.2);
    close(edges.left, 0);
    close(edges.top, 0);
  });

  it('pads the picture when a handle is dragged past the image', () => {
    const s = dragCropHandle(cropState(100, 80, NO_CROP), 'nw', {
      x: -10,
      y: -8,
    });
    const edges = cropEdges(s);
    close(edges.left, -0.1);
    close(edges.top, -0.1);
  });

  it('keeps the aspect ratio with Shift and crops both sides with Ctrl', () => {
    const start = cropState(100, 50, NO_CROP);
    const aspect = dragCropHandle(
      start,
      'se',
      { x: -40, y: -5 },
      {
        keepAspect: true,
      }
    );
    close(aspect.frame.w / aspect.frame.h, 2);
    close(aspect.frame.x, 0);
    close(aspect.frame.y, 0);
    const both = dragCropHandle(
      start,
      'w',
      { x: 10, y: 0 },
      {
        symmetric: true,
      }
    );
    close(both.frame.x, 10);
    close(both.frame.w, 80);
    const edges = cropEdges(both);
    close(edges.left, 0.1);
    close(edges.right, 0.1);
  });

  it('never makes the frame smaller than the minimum', () => {
    const s = dragCropHandle(
      cropState(100, 80, NO_CROP),
      'w',
      { x: 500, y: 0 },
      {
        minSize: 4,
      }
    );
    close(s.frame.w, 4);
    close(s.frame.x, 96);
  });

  it('pans and scales the image under the frame', () => {
    const start = cropState(100, 80, NO_CROP);
    const panned = panCrop(start, { x: 10, y: -4 });
    expect(panned.frame).toEqual(start.frame);
    close(cropEdges(panned).left, -0.1);
    close(cropEdges(panned).right, 0.1);
    const scaled = scaleCropImage(start, 'se', { x: 50, y: 0 });
    close(scaled.image.w, 150);
    close(scaled.image.h, 120);
    close(scaled.image.x, 0);
    expect(cropChanged(start, scaled)).toBe(true);
    expect(cropChanged(start, panCrop(start, { x: 0, y: 0 }))).toBe(false);
  });
});

describe('crop operations', () => {
  it('crops in one operation when only the frame moved', () => {
    const shape = picture({});
    const start = cropState(shape.w, shape.h, NO_CROP);
    const ops = cropOps(
      256,
      shape,
      start,
      dragCropHandle(start, 'n', { x: 0, y: 20 })
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'cropPicture', slide: 256, shape: 5 });
    close((ops[0] as { top: number }).top, 0.25);
  });

  it('puts the frame back where it was when the image was panned', () => {
    const shape = picture({});
    const start = cropState(shape.w, shape.h, NO_CROP);
    const ops = cropOps(256, shape, start, panCrop(start, { x: 10, y: 0 }));
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ op: 'setTransform', w: 100, h: 80 });
    close((ops[1] as { x: number }).x, 100);
    close((ops[1] as { y: number }).y, 50);
  });

  it('maps local points through rotation and flips', () => {
    const frame = picture({ rotation: 90, flipH: true });
    // The local top-left corner: flipped to the right, then turned down.
    const p = localToSlide(frame, { x: 0, y: 0 });
    close(p.x, 190);
    close(p.y, 140);
    const d = slideDeltaToLocal(frame, { x: 0, y: 10 });
    close(d.x, -10);
    close(d.y, 0);
  });
});

describe('aspect ratio crops', () => {
  it('crops the largest centered part of the whole image', () => {
    const square = aspectCrop(200, 100, NO_CROP, 1);
    close(square.left, 0.25);
    close(square.right, 0.25);
    close(square.top, 0);
    const wide = aspectCrop(100, 100, NO_CROP, 16 / 9);
    close(wide.left, 0);
    close(wide.top, (1 - 9 / 16) / 2);
    close(wide.bottom, (1 - 9 / 16) / 2);
  });

  it('measures the whole image, not the current crop', () => {
    // A 100×100 image cropped to its left half (50×100 shown).
    const crop = aspectCrop(
      50,
      100,
      { left: 0, top: 0, right: 0.5, bottom: 0 },
      1
    );
    expect(crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe('presets', () => {
  it('lists the Corrections and Recolor galleries', () => {
    expect(CORRECTION_STEPS).toEqual([-0.4, -0.2, 0, 0.2, 0.4]);
    expect(correctionKey(0.2, -0.4)).toBe('b+20_c-40');
    expect(correctionKey(0, 0)).toBe('b0_c0');
    expect(RECOLOR_ROWS.map((r) => r.presets.length)).toEqual([7, 7, 7]);
    expect(RECOLOR_ROWS[1].presets[1].value).toBe('duotone:accent1');
    expect(RECOLOR_ROWS[2].presets[0].value).toBe('duotoneLight:bg2');
    expect(recolorKey('duotone:accent1')).toBe('duotone-accent1');
  });

  it('finds the image a copied picture embeds', () => {
    const payload = JSON.stringify({
      shapes: [
        '<p:pic><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:pic>',
      ],
      rels: [{ id: 'rId3', target: '/ppt/media/image2.png' }],
      parts: [
        {
          name: '/ppt/media/image1.jpeg',
          contentType: 'image/jpeg',
          data: 'AA',
        },
        { name: '/ppt/media/image2.png', contentType: 'image/png', data: 'BB' },
      ],
    });
    expect(pictureImagePart(payload)).toEqual({
      contentType: 'image/png',
      data: 'BB',
    });
    expect(pictureImagePart('not json')).toBeUndefined();
  });
});

describe('preview pixels', () => {
  const pixel = (r: number, g: number, b: number, a = 255) =>
    new Uint8ClampedArray([r, g, b, a]);

  it('applies brightness and contrast as the renderer does', () => {
    const p = pixel(128, 128, 128);
    adjustPixels(p, {
      brightness: 0.2,
      contrast: 0,
      recolor: null,
      transparency: 0,
    });
    expect(p[0]).toBe(179);
    const q = pixel(200, 50, 128);
    adjustPixels(q, {
      brightness: 0,
      contrast: 0.5,
      recolor: null,
      transparency: 0,
    });
    expect(q[0]).toBe(255);
    expect(q[1]).toBe(0);
  });

  it('recolors and makes transparent', () => {
    const theme: [string, string][] = [['accent1', '#4472C4']];
    const gray = pixel(255, 0, 0);
    adjustPixels(gray, {
      brightness: 0,
      contrast: 0,
      recolor: resolveRecolor('grayscale', theme),
      transparency: 0.5,
    });
    expect([gray[0], gray[1], gray[2]]).toEqual([76, 76, 76]);
    expect(gray[3]).toBe(128);
    const bw = pixel(100, 100, 100);
    adjustPixels(bw, {
      brightness: 0,
      contrast: 0,
      recolor: resolveRecolor('blackWhite25', theme),
      transparency: 0,
    });
    expect(bw[0]).toBe(255);
    const dark = resolveRecolor('duotone:accent1', theme);
    expect(dark?.kind).toBe('duotone');
    if (dark?.kind === 'duotone') expect(dark.light).toEqual([1, 1, 1]);
    const light = resolveRecolor('duotoneLight:accent1', theme);
    if (light?.kind === 'duotone') expect(light.dark).toEqual([0, 0, 0]);
    expect(resolveRecolor('none', theme)).toBeNull();
  });
});
