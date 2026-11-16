import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createDescriptionClamp } from './create-description-clamp';

describe('project description clamp', () => {
  it('retains overflow while expanded and remeasures when collapsed', () => {
    createRoot((dispose) => {
      const clamp = createDescriptionClamp();
      clamp.measure(96, 72);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      clamp.measure(96, 96);
      expect(clamp.expanded()).toBe(true);
      expect(clamp.overflowing()).toBe(true);
      clamp.toggle();
      clamp.measure(60, 72);
      expect(clamp.expanded()).toBe(false);
      expect(clamp.overflowing()).toBe(false);
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
