import { createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { FloatRegions } from './float-region-state';

it('follows the winning pane and releases its detail scope when the detail closes', () => {
  const main = document.createElement('main');
  const detail = document.createElement('section');
  const other = document.createElement('main');
  const [detailActive, setDetailActive] = createSignal(true);
  const removeMain = FloatRegions.registerScope({
    pane: 'first',
    anchor: () => main,
    isActive: () => true,
  });
  const removeDetail = FloatRegions.registerScope({
    pane: 'first',
    anchor: () => detail,
    isActive: detailActive,
  });
  const removeOther = FloatRegions.registerScope({
    pane: 'second',
    anchor: () => other,
    isActive: () => true,
  });
  const contribution = FloatRegions.register({
    region: 'accessory',
    pane: 'first',
    priority: 0,
    isActive: () => true,
  });
  try {
    expect(FloatRegions.anchor('accessory')).toBe(detail);
    setDetailActive(false);
    expect(FloatRegions.anchor('accessory')).toBe(main);
    setDetailActive(true);
    expect(FloatRegions.anchor('accessory')).toBe(detail);
    removeDetail();
    expect(FloatRegions.anchor('accessory')).toBe(main);
  } finally {
    contribution.unregister();
    removeMain();
    removeDetail();
    removeOther();
  }
  expect(FloatRegions.anchor('accessory')).toBeUndefined();
});

it('keeps pane chrome scoped while a global overlay can take over and restore it', () => {
  const pane = document.createElement('main');
  const [overlayActive, setOverlayActive] = createSignal(false);
  const contribution = FloatRegions.register({
    region: 'accessory',
    anchor: () => pane,
    priority: 0,
    isActive: () => true,
  });
  const overlay = FloatRegions.register({
    region: 'accessory',
    priority: 100,
    isActive: overlayActive,
  });
  const dock = FloatRegions.register({
    region: 'dock',
    priority: 0,
    isActive: () => true,
  });
  try {
    expect(FloatRegions.anchor('accessory')).toBe(pane);
    expect(FloatRegions.anchor('dock')).toBeUndefined();
    setOverlayActive(true);
    expect(FloatRegions.anchor('accessory')).toBeUndefined();
    setOverlayActive(false);
    expect(FloatRegions.anchor('accessory')).toBe(pane);
  } finally {
    contribution.unregister();
    overlay.unregister();
    dock.unregister();
  }
});
