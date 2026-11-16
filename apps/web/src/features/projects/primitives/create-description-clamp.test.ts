import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createDescriptionClamp,
  descriptionLineLimit,
} from './create-description-clamp';

describe('project description clamp', () => {
  it.each([
    [undefined, 8],
    [240, 8],
    [192, 8],
    [191, 7],
    [168, 7],
    [144, 6],
    [120, 5],
    [96, 5],
  ])(
    'fits the largest five-to-eight-line preview in %s pixels',
    (height, lines) => {
      expect(descriptionLineLimit(height, 24)).toBe(lines);
    }
  );

  it('tracks eight-line overflow while expanded and after collapsing', () => {
    createRoot((dispose) => {
      const clamp = createDescriptionClamp();
      clamp.measure(216, 24);
      expect(clamp.lines()).toBe(8);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      clamp.measure(240, 24);
      expect(clamp.expanded()).toBe(true);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      clamp.measure(180, 24);
      expect(clamp.expanded()).toBe(false);
      expect(clamp.overflowing()).toBe(false);
      dispose();
    });
  });

  it('keeps disclosure and editing state when the viewport budget changes', () => {
    createRoot((dispose) => {
      const clamp = createDescriptionClamp();
      clamp.measure(168, 24);
      expect(clamp.overflowing()).toBe(false);
      clamp.measure(168, 24, 120);
      expect(clamp.lines()).toBe(5);
      expect(clamp.overflowing()).toBe(true);
      clamp.expand();
      clamp.measure(240, 24, 144);
      expect(clamp.lines()).toBe(6);
      expect(clamp.expanded()).toBe(true);
      expect(clamp.overflowing()).toBe(true);
      clamp.measure(24, 24, 144);
      expect(clamp.overflowing()).toBe(false);
      clamp.measure(240, 24, 144);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      expect(clamp.expanded()).toBe(false);
      dispose();
    });
  });
});
