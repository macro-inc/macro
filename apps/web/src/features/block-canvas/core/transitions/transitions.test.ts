import { createScene, type ShapeItem, translation } from '@macro-inc/graphics';
import { describe, expect, it } from 'vitest';
import {
  cameraTransform,
  fitView,
  flyPath,
  overviewPath,
  panPath,
  pointAlong,
  routePath,
} from './camera-path';
import { cameraPlan } from './camera-plan';
import { classicKeyframes, type LayerKeyframe } from './classic-keyframes';
import { easingCss, easingFunction } from './easing';
import { connectorRoute } from './scene-geometry';

const STAGE = { width: 1600, height: 900 };

describe('easing', () => {
  it('matches the CSS keyword curves at their known points', () => {
    expect(easingCss('linear')).toBe('linear');
    expect(easingCss('easeInOut')).toBe('cubic-bezier(0.42, 0, 0.58, 1)');

    const easeInOut = easingFunction('easeInOut');
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
    expect(easeInOut(0.25)).toBeCloseTo(1 - easeInOut(0.75), 5);

    // easeIn starts slow and easeOut starts fast.
    expect(easingFunction('easeIn')(0.25)).toBeLessThan(0.25);
    expect(easingFunction('easeOut')(0.25)).toBeGreaterThan(0.25);
    // CSS `ease` at 50% progress is about 80% done.
    expect(easingFunction('ease')(0.5)).toBeCloseTo(0.8024, 3);
  });

  it('is monotonic', () => {
    for (const name of ['ease', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      const ease = easingFunction(name);
      let previous = 0;
      for (let step = 1; step <= 100; step++) {
        const value = ease(step / 100);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });
});

describe('direction mirroring', () => {
  const normalized = (frames: readonly LayerKeyframe[]) =>
    frames.map(({ offset: _offset, ...frame }) => frame);
  const size = { width: 1000, height: 600 };

  it('plays a backward push left as a forward push right', () => {
    const backward = classicKeyframes('push', 'left', true, size);
    const right = classicKeyframes('push', 'right', false, size);
    expect(normalized(backward.outgoing)).toEqual(normalized(right.outgoing));
    expect(normalized(backward.incoming)).toEqual(normalized(right.incoming));
  });

  it('turns a backward cover into an uncover the other way', () => {
    const backward = classicKeyframes('cover', 'up', true, size);
    const uncover = classicKeyframes('uncover', 'down', false, size);
    expect(backward.incomingOnTop).toBe(false);
    expect(normalized(backward.outgoing)).toEqual(normalized(uncover.outgoing));
  });

  it('closes an opening split when going back', () => {
    const backward = classicKeyframes('split', 'left', true, size);
    const closing = classicKeyframes('split', 'right', false, size);
    expect(normalized(backward.outgoing)).toEqual(normalized(closing.outgoing));
    expect(backward.incomingOnTop).toBe(closing.incomingOnTop);
  });

  it('reverses keyframe offsets in time', () => {
    const backward = classicKeyframes('fadeThroughBlack', 'left', true, size);
    expect(backward.incoming.map((frame) => frame.offset)).toEqual([0, 0.5, 1]);
    expect(backward.incoming.map((frame) => frame.opacity)).toEqual([0, 0, 1]);
  });
});

describe('camera paths', () => {
  const a = fitView({ x: 0, y: 0, width: 1600, height: 900 }, STAGE);
  const b = fitView({ x: 8000, y: 0, width: 1600, height: 900 }, STAGE);

  it('fits a slide exactly to the stage', () => {
    expect(a).toEqual({ x: 800, y: 450, zoom: 1 });
    expect(cameraTransform(a, { x: 0, y: 0 }, 1, STAGE)).toBe(
      'translate(0px, 0px) scale(1)'
    );
  });

  it('pans at a constant zoom between equal slides', () => {
    const path = panPath(a, b);
    expect(path(0.5)).toEqual({ x: 4800, y: 450, zoom: 1 });
  });

  it('flies out in proportion to distance, then back in', () => {
    const path = flyPath(a, b, STAGE);
    expect(path(0)).toEqual(a);
    expect(path(1)).toEqual(b);

    const middle = path(0.5);
    expect(middle.x).toBeCloseTo(4800, 0);
    expect(middle.zoom).toBeLessThan(0.5);
    // A slide twice as far needs a wider pull-back.
    const far = flyPath(a, { ...b, x: b.x * 2 }, STAGE)(0.5);
    expect(far.zoom).toBeLessThan(middle.zoom);
    // The path is continuous.
    const near = path(0.501);
    expect(Math.abs(near.x - middle.x)).toBeLessThan(100);
  });

  it('zooms only when both slides share a center', () => {
    const zoomed = { ...a, zoom: 4 };
    const path = flyPath(a, zoomed, STAGE);
    expect(path(0.5).zoom).toBeCloseTo(2, 5);
  });

  it('holds on the overview in the middle', () => {
    const overview = { x: 4800, y: 450, zoom: 0.15 };
    const path = overviewPath(a, b, overview, STAGE);
    expect(path(0.5)).toEqual(overview);
    expect(path(1)).toEqual(b);
  });

  it('samples a route by arc length and follows it', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 300 },
    ];
    expect(pointAlong(route, 0.25)).toEqual({ x: 100, y: 0 });
    expect(pointAlong(route, 0.5)).toEqual({ x: 100, y: 100 });
    expect(pointAlong(route, 1)).toEqual({ x: 100, y: 300 });

    const path = routePath(
      a,
      b,
      [
        { x: 1600, y: 450 },
        { x: 4800, y: 3000 },
        { x: 8000, y: 450 },
      ],
      STAGE
    );
    expect(path(0)).toEqual(a);
    expect(path(1).x).toBeCloseTo(b.x);
    expect(path(0.5).y).toBeGreaterThan(1000);
  });
});

describe('camera plans', () => {
  const artifact = (
    id: string,
    x: number,
    y: number,
    key: string
  ): ShapeItem<'artifact'> => ({
    id,
    type: 'artifact',
    placement: { parentId: 'scene-root', sortKey: key },
    transform: translation(x, y),
    appearance: { fill: 'transparent', stroke: 'transparent' },
    geometry: {
      width: 320,
      height: 180,
      title: id,
      html: '',
      designWidth: 640,
      designHeight: 360,
      presentOrder: key,
    },
  });
  const connector: ShapeItem<'connector'> = {
    id: 'link',
    type: 'connector',
    placement: { parentId: 'scene-root', sortKey: 'a2' },
    transform: translation(0, 0),
    appearance: { fill: 'transparent', stroke: '#000' },
    geometry: {
      start: {
        point: { x: 0, y: 0 },
        binding: { targetId: 'b', anchor: 'bottom' },
      },
      end: {
        point: { x: 0, y: 0 },
        binding: { targetId: 'a', anchor: 'bottom' },
      },
      route: 'stepped',
      startHead: 'none',
      endHead: 'arrow',
    },
  };
  const document = createScene([
    artifact('a', 0, 0, 'a0'),
    artifact('b', 1000, 0, 'a1'),
    connector,
  ]);
  const a = document.items.a as ShapeItem<'artifact'>;
  const b = document.items.b as ShapeItem<'artifact'>;

  it('orients a connector route from the slide being left', () => {
    const route = connectorRoute(document, 'a', 'b');
    expect(route?.[0]).toEqual({ x: 160, y: 180 });
    expect(route?.at(-1)).toEqual({ x: 1160, y: 180 });
    expect(connectorRoute(document, 'a', 'missing')).toBeUndefined();
  });

  it('starts and ends on the slides as present mode frames them', () => {
    const plan = cameraPlan({
      document,
      from: a,
      to: b,
      kind: 'path',
      stage: STAGE,
      ease: (t) => t,
      durationMs: 1600,
    });
    expect(plan.followedRoute).toBe(true);
    expect(plan.fromScreen).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
    expect(plan.toScreen.width).toBeCloseTo(1600);
    expect(plan.views[0]).toEqual({ x: 160, y: 90, zoom: 5 });
    expect(plan.views.at(-1)?.x).toBeCloseTo(1160);
    // The elbow connector dips below the slides, so the camera does too.
    expect(Math.max(...plan.views.map((view) => view.y))).toBeGreaterThan(180);
    expect(plan.baseScale).toBeLessThanOrEqual(
      Math.min(...plan.views.map((v) => v.zoom))
    );
  });
});
