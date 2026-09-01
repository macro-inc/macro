import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  type BreakpointThresholds,
  createSizeBreakpoints,
  matchesBreakpoint,
} from './create-size-breakpoints';

describe('matchesBreakpoint', () => {
  it('treats unmeasured size as false', () => {
    expect(matchesBreakpoint(undefined, 720)).toBe(false);
    expect(matchesBreakpoint(undefined, { min: 100 })).toBe(false);
  });

  it('treats a number as max-width', () => {
    expect(matchesBreakpoint(720, 720)).toBe(true);
    expect(matchesBreakpoint(721, 720)).toBe(false);
  });

  it('supports max-only, min-only, and inclusive ranges', () => {
    expect(matchesBreakpoint(720, { max: 720 })).toBe(true);
    expect(matchesBreakpoint(721, { max: 720 })).toBe(false);

    expect(matchesBreakpoint(480, { min: 480 })).toBe(true);
    expect(matchesBreakpoint(479, { min: 480 })).toBe(false);

    expect(matchesBreakpoint(500, { min: 480, max: 720 })).toBe(true);
    expect(matchesBreakpoint(480, { min: 480, max: 720 })).toBe(true);
    expect(matchesBreakpoint(720, { min: 480, max: 720 })).toBe(true);
    expect(matchesBreakpoint(479, { min: 480, max: 720 })).toBe(false);
    expect(matchesBreakpoint(721, { min: 480, max: 720 })).toBe(false);
  });
});

describe('createSizeBreakpoints', () => {
  it('exposes keyed reactive accessors for number thresholds', () => {
    const dispose = createRoot((rootDispose) => {
      const [width, setWidth] = createSignal<number | undefined>();
      const breakpoints = createSizeBreakpoints(width, {
        dense: 480,
        narrow: 720,
      });

      expect(breakpoints.narrow()).toBe(false);
      expect(breakpoints.dense()).toBe(false);

      setWidth(500);
      expect(breakpoints.narrow()).toBe(true);
      expect(breakpoints.dense()).toBe(false);

      setWidth(400);
      expect(breakpoints.narrow()).toBe(true);
      expect(breakpoints.dense()).toBe(true);

      setWidth(800);
      expect(breakpoints.narrow()).toBe(false);
      expect(breakpoints.dense()).toBe(false);

      return rootDispose;
    });
    dispose();
  });

  it('supports min/max range objects', () => {
    const dispose = createRoot((rootDispose) => {
      const [width, setWidth] = createSignal<number | undefined>(600);
      const breakpoints = createSizeBreakpoints(width, {
        dense: { max: 480 },
        mid: { min: 481, max: 720 },
        wide: { min: 721 },
      });

      expect(breakpoints.dense()).toBe(false);
      expect(breakpoints.mid()).toBe(true);
      expect(breakpoints.wide()).toBe(false);

      setWidth(400);
      expect(breakpoints.dense()).toBe(true);
      expect(breakpoints.mid()).toBe(false);
      expect(breakpoints.wide()).toBe(false);

      setWidth(900);
      expect(breakpoints.dense()).toBe(false);
      expect(breakpoints.mid()).toBe(false);
      expect(breakpoints.wide()).toBe(true);

      return rootDispose;
    });
    dispose();
  });

  it('tracks reactive threshold definitions', () => {
    const dispose = createRoot((rootDispose) => {
      const [width] = createSignal(600);
      const [thresholds, setThresholds] = createSignal<BreakpointThresholds>({
        narrow: 720,
      });
      const breakpoints = createSizeBreakpoints(width, thresholds);

      expect(breakpoints.narrow()).toBe(true);

      setThresholds({ narrow: 480 });
      expect(breakpoints.narrow()).toBe(false);

      setThresholds({ compact: 500 });
      expect(breakpoints.narrow()).toBe(false);
      expect(breakpoints.compact).toBeUndefined();

      return rootDispose;
    });
    dispose();
  });

  it('rejects invalid thresholds', () => {
    createRoot((dispose) => {
      expect(() =>
        createSizeBreakpoints(() => 100, { bad: Number.NaN })
      ).toThrow(/bad/);
      expect(() => createSizeBreakpoints(() => 100, { bad: -1 })).toThrow(
        /bad/
      );
      expect(() => createSizeBreakpoints(() => 100, { bad: {} })).toThrow(
        /min, max/
      );
      expect(() =>
        createSizeBreakpoints(() => 100, { bad: { min: 800, max: 400 } })
      ).toThrow(/min/);
      dispose();
    });
  });
});
