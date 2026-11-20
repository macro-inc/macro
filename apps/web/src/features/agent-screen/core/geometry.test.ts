import { describe, expect, it } from 'vitest';
import {
  clampViewport,
  FIT_VIEWPORT,
  frameTransform,
  keepInView,
  layoutFrame,
  panBy,
  toGuestPoint,
  toViewerPoint,
  type ViewGeometry,
  zoomAt,
} from './geometry';

const LANDSCAPE: ViewGeometry = {
  container: { width: 960, height: 600 },
  frame: { width: 1920, height: 1080 },
  rotation: 0,
};

describe('layoutFrame', () => {
  it('fits a 1920x1080 frame into 960x600 with a letterbox above and below', () => {
    expect(layoutFrame(LANDSCAPE, FIT_VIEWPORT)).toEqual({
      scale: 0.5,
      width: 960,
      height: 540,
      left: 0,
      top: 30,
    });
  });
});

describe('toGuestPoint', () => {
  it('maps the fitted frame corners and centre', () => {
    expect(toGuestPoint(LANDSCAPE, FIT_VIEWPORT, { x: 0, y: 30 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(toGuestPoint(LANDSCAPE, FIT_VIEWPORT, { x: 480, y: 300 })).toEqual({
      x: 960,
      y: 540,
    });
    expect(
      toGuestPoint(LANDSCAPE, FIT_VIEWPORT, { x: 959.9, y: 569.9 })
    ).toEqual({ x: 1919, y: 1079 });
  });

  it('returns undefined in the letterbox', () => {
    expect(toGuestPoint(LANDSCAPE, FIT_VIEWPORT, { x: 100, y: 10 })).toBe(
      undefined
    );
    expect(toGuestPoint(LANDSCAPE, FIT_VIEWPORT, { x: 100, y: 590 })).toBe(
      undefined
    );
  });

  it('follows zoom and pan', () => {
    // 2x zoom about the centre: the container centre still shows the frame centre.
    const zoomed = { zoom: 2, panX: 0, panY: 0 };
    expect(toGuestPoint(LANDSCAPE, zoomed, { x: 480, y: 300 })).toEqual({
      x: 960,
      y: 540,
    });
    // At 2x the frame is 1920x1080 CSS px centred in 960x600, so the
    // viewer's top-left shows guest (480, 240).
    expect(toGuestPoint(LANDSCAPE, zoomed, { x: 0, y: 0 })).toEqual({
      x: 480,
      y: 240,
    });
    // Panning right by 100 CSS px moves the content right: the same point
    // shows guest pixels 100 CSS px = 100 guest px further left.
    expect(
      toGuestPoint(
        LANDSCAPE,
        { zoom: 2, panX: 100, panY: 0 },
        { x: 480, y: 300 }
      )
    ).toEqual({ x: 860, y: 540 });
  });

  it('undoes each quarter turn', () => {
    // A portrait phone showing the landscape guest turned clockwise: scale 0.5,
    // the guest's top-left at the viewer's top-right.
    const turned: ViewGeometry = {
      container: { width: 540, height: 960 },
      frame: { width: 1920, height: 1080 },
      rotation: 90,
    };
    expect(toGuestPoint(turned, FIT_VIEWPORT, { x: 539.9, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(toGuestPoint(turned, FIT_VIEWPORT, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 1079,
    });
    expect(
      toGuestPoint({ ...turned, rotation: 270 }, FIT_VIEWPORT, { x: 0, y: 0 })
    ).toEqual({ x: 1919, y: 0 });
    expect(
      toGuestPoint({ ...LANDSCAPE, rotation: 180 }, FIT_VIEWPORT, {
        x: 0,
        y: 30,
      })
    ).toEqual({ x: 1919, y: 1079 });
  });
});

describe('frameTransform', () => {
  it('places the guest top-left where toGuestPoint reads it', () => {
    expect(frameTransform(LANDSCAPE, FIT_VIEWPORT)).toBe(
      'translate(0px, 30px) rotate(0deg) scale(0.5)'
    );
    // Rotated: guest (0,0) scales to (0,0), turns to (0,0), lands at (540,0),
    // the viewer's top-right, which toGuestPoint maps back to guest (0,0).
    expect(
      frameTransform(
        {
          container: { width: 540, height: 960 },
          frame: { width: 1920, height: 1080 },
          rotation: 90,
        },
        FIT_VIEWPORT
      )
    ).toBe('translate(540px, 0px) rotate(90deg) scale(0.5)');
  });
});

describe('viewport changes', () => {
  it('keeps a zoomed frame covering the container', () => {
    // At 2x the frame is 1920x1080 CSS px in a 960x600 viewer: it can pan
    // 480 px either way horizontally and 240 px vertically.
    expect(
      clampViewport(LANDSCAPE, { zoom: 2, panX: 900, panY: -900 })
    ).toEqual({ zoom: 2, panX: 480, panY: -240 });
    expect(clampViewport(LANDSCAPE, { zoom: 0.2, panX: 50, panY: 50 })).toEqual(
      { zoom: 1, panX: 0, panY: 0 }
    );
  });

  it('zooms about the pinch point', () => {
    const zoomed = zoomAt(LANDSCAPE, FIT_VIEWPORT, 2, { x: 240, y: 165 });
    // The guest pixel under the pinch point stays under it.
    expect(toGuestPoint(LANDSCAPE, FIT_VIEWPORT, { x: 240, y: 165 })).toEqual({
      x: 480,
      y: 270,
    });
    expect(toGuestPoint(LANDSCAPE, zoomed, { x: 240, y: 165 })).toEqual({
      x: 480,
      y: 270,
    });
  });

  it('pans within bounds', () => {
    const zoomed = { zoom: 2, panX: 0, panY: 0 };
    expect(panBy(LANDSCAPE, zoomed, -100, 20)).toEqual({
      zoom: 2,
      panX: -100,
      panY: 20,
    });
    expect(panBy(LANDSCAPE, FIT_VIEWPORT, -100, 20)).toEqual(FIT_VIEWPORT);
  });
});

describe('keepInView', () => {
  it('pans just enough to keep a dragged guest pointer 32px inside the viewer while zoomed', () => {
    const zoomed = { zoom: 4, panX: 0, panY: 0 };
    // At 4x (2 CSS px per guest px) guest x 1100 sits at viewer x 761: in view.
    expect(keepInView(LANDSCAPE, zoomed, { x: 1100, y: 540 })).toEqual(zoomed);
    // Guest x 1200 sits at 961, past the right edge less the margin (928).
    expect(keepInView(LANDSCAPE, zoomed, { x: 1200, y: 540 })).toEqual({
      zoom: 4,
      panX: -33,
      panY: 0,
    });
    // At fit the whole frame is visible: nothing to follow.
    expect(keepInView(LANDSCAPE, FIT_VIEWPORT, { x: 1919, y: 0 })).toEqual(
      FIT_VIEWPORT
    );
  });

  it('maps guest pixels back to the viewer under rotation', () => {
    const portrait: ViewGeometry = { ...LANDSCAPE, rotation: 90 };
    const zoomed = { zoom: 2, panX: 40, panY: -20 };
    const guest = { x: 700, y: 300 };
    const viewer = toViewerPoint(portrait, zoomed, guest);
    expect(toGuestPoint(portrait, zoomed, viewer)).toEqual(guest);
  });
});
