import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createDescriptionClamp } from './create-description-clamp';

describe('project description clamp', () => {
  it('tracks natural overflow while expanded and after collapsing', () => {
    createRoot((dispose) => {
      const clamp = createDescriptionClamp();
      clamp.measure(96, 72);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      clamp.measure(120, 72);
      expect(clamp.expanded()).toBe(true);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      clamp.measure(60, 72);
      expect(clamp.expanded()).toBe(false);
      expect(clamp.overflowing()).toBe(false);
      dispose();
    });
  });

  it('reveals Show less when an initially short description grows during editing', () => {
    createRoot((dispose) => {
      const clamp = createDescriptionClamp();
      clamp.measure(24, 72);
      clamp.expand();
      expect(clamp.overflowing()).toBe(false);

      clamp.measure(96, 72);
      expect(clamp.expanded()).toBe(true);
      expect(clamp.overflowing()).toBe(true);
      clamp.measure(24, 72);
      expect(clamp.expanded()).toBe(true);
      expect(clamp.overflowing()).toBe(false);
      clamp.measure(96, 72);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      expect(clamp.expanded()).toBe(false);
      dispose();
    });
  });
  it('expands for editing without remounting the content', () => {
    createRoot((dispose) => {
      const clamp = createDescriptionClamp();
      clamp.expand();
      expect(clamp.expanded()).toBe(true);
      dispose();
    });
  });
});
