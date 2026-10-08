import { describe, expect, it } from 'vitest';
import {
  fitRect,
  MAX_ZOOM,
  MIN_ZOOM,
  pageToScreen,
  screenToPage,
  stepZoom,
  unionRects,
  zoomAt,
  zoomLabel,
} from './camera';

describe('camera', () => {
  it('maps between screen and page coordinates', () => {
    const camera = { x: 100, y: 50, zoom: 2 };
    const page = screenToPage(camera, { x: 40, y: 20 });
    expect(page).toEqual({ x: 120, y: 60 });
    expect(pageToScreen(camera, page)).toEqual({ x: 40, y: 20 });
  });

  it('keeps the anchor fixed while zooming', () => {
    const camera = { x: 10, y: 20, zoom: 1 };
    const anchor = { x: 300, y: 200 };
    const before = screenToPage(camera, anchor);
    const zoomed = zoomAt(camera, 4, anchor);
    expect(zoomed.zoom).toBe(4);
    const after = screenToPage(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom to Figma’s range', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 1e6, { x: 0, y: 0 }).zoom).toBe(
      MAX_ZOOM
    );
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 1e-9, { x: 0, y: 0 }).zoom).toBe(
      MIN_ZOOM
    );
  });

  it('fits a rectangle in the viewport, centered', () => {
    const camera = fitRect(
      { x: 0, y: 0, w: 1000, h: 500 },
      { w: 1096, h: 1000 }
    );
    expect(camera.zoom).toBeCloseTo(1);
    const center = pageToScreen(camera, { x: 500, y: 250 });
    expect(center.x).toBeCloseTo(548);
    expect(center.y).toBeCloseTo(500);
  });

  it('caps the zoom when fitting small content', () => {
    const camera = fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 800, h: 600 }, 1);
    expect(camera.zoom).toBe(1);
  });

  it('steps zoom by powers of two', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(0.37, 1)).toBe(0.5);
    expect(stepZoom(0.37, -1)).toBe(0.25);
    expect(stepZoom(3, -1)).toBe(2);
  });

  it('labels zoom like Figma', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(0.333)).toBe('33%');
    expect(zoomLabel(0.005)).toBe('0.5%');
    expect(zoomLabel(0.01)).toBe('1%');
  });

  it('unions rectangles and skips empty ones', () => {
    expect(
      unionRects([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: Number.POSITIVE_INFINITY, y: 0, w: -1, h: 0 },
        { x: 20, y: -5, w: 5, h: 5 },
      ])
    ).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(unionRects([])).toBeUndefined();
  });
});
