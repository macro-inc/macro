import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createResizeSolver } from './solver';

describe('createResizeSolver', () => {
  describe('swap', () => {
    it('reorders registered panels without changing their sizing intent', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1000,
          panels: [],
        }),
      }));

      solver.addPanel({ id: 'A', minSize: 0 });
      solver.addPanel({ id: 'B', minSize: 0 });
      await Promise.resolve();
      solver.moveHandle(0, 200);
      expect(solver.solve().sizes.get('A')).toBe(700);
      expect(solver.solve().sizes.get('B')).toBe(300);

      solver.swap('A', 'B');

      expect(solver.order()).toEqual(['B', 'A']);
      expect(solver.solve().sizes.get('A')).toBe(700);
      expect(solver.solve().sizes.get('B')).toBe(300);

      dispose();
    });
  });

  describe('addPanel', () => {
    it('should insert a panel at index 0 when index=0 is passed', () => {
      createRoot((dispose) => {
        const solver = createResizeSolver({
          direction: 'horizontal',
          gutter: () => 4,
          size: () => 1000,
          panels: [{ id: 'A', minSize: 100, maxSize: Infinity }],
        });

        expect(solver.order()).toEqual(['A']);

        // Insert "B" at index 0 — should go BEFORE "A"
        solver.addPanel({ id: 'B', minSize: 100, maxSize: Infinity }, 0);

        expect(solver.order()).toEqual(['B', 'A']);

        dispose();
      });
    });

    it('should insert a panel at a specific index', () => {
      createRoot((dispose) => {
        const solver = createResizeSolver({
          direction: 'horizontal',
          gutter: () => 4,
          size: () => 1000,
          panels: [
            { id: 'A', minSize: 100, maxSize: Infinity },
            { id: 'C', minSize: 100, maxSize: Infinity },
          ],
        });

        expect(solver.order()).toEqual(['A', 'C']);

        // Insert "B" at index 1 — should go between "A" and "C"
        solver.addPanel({ id: 'B', minSize: 100, maxSize: Infinity }, 1);

        expect(solver.order()).toEqual(['A', 'B', 'C']);

        dispose();
      });
    });

    it('should append when no index is given', () => {
      createRoot((dispose) => {
        const solver = createResizeSolver({
          direction: 'horizontal',
          gutter: () => 4,
          size: () => 1000,
          panels: [{ id: 'A', minSize: 100, maxSize: Infinity }],
        });

        solver.addPanel({ id: 'B', minSize: 100, maxSize: Infinity });

        expect(solver.order()).toEqual(['A', 'B']);

        dispose();
      });
    });

    it('should not duplicate a panel that already exists', () => {
      createRoot((dispose) => {
        const solver = createResizeSolver({
          direction: 'horizontal',
          gutter: () => 4,
          size: () => 1000,
          panels: [{ id: 'A', minSize: 100, maxSize: Infinity }],
        });

        solver.addPanel({ id: 'A', minSize: 100, maxSize: Infinity }, 0);

        expect(solver.order()).toEqual(['A']);

        dispose();
      });
    });
  });

  describe('redistributionPreferredSize', () => {
    it('waits until another panel can absorb the redistributed space', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 8,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'sidebar', minSize: 100 });
      solver.updatePanel('sidebar', {
        redistributionPreferredSize: 440,
      });
      expect(solver.solve().sizes.get('sidebar')).toBe(1600);

      solver.addPanel({ id: 'content', minSize: 100 });
      expect(solver.solve().sizes.get('sidebar')).toBe(440);

      dispose();
    });

    it('restores the preference after automatic redistribution without constraining manual resizing', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 8,
          size: () => 1600,
          panels: [],
        }),
      }));

      // createEffect performs its initial solve after the root body.
      await Promise.resolve();

      solver.addPanel({ id: 'sidebar', minSize: 100 });
      solver.addPanel({ id: 'content', minSize: 100 });
      solver.addPanel({ id: 'adjacent', minSize: 100 });
      solver.updatePanel('sidebar', { redistributionPreferredSize: 440 });

      expect(solver.solve().sizes.get('sidebar')).toBe(440);

      solver.moveHandle(0, 160);
      expect(solver.solve().sizes.get('sidebar')).toBe(600);

      solver.dropPanel('adjacent');
      expect(solver.solve().sizes.get('sidebar')).toBe(440);

      dispose();
    });

    it('grows beyond an equal share when the preferred size fits', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 8,
          size: () => 2000,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'sidebar', minSize: 400 });
      solver.updatePanel('sidebar', {
        redistributionPreferredSize: 1200,
      });
      solver.addPanel({ id: 'content', minSize: 400 });

      expect(solver.solve().sizes.get('sidebar')).toBe(1200);

      solver.moveHandle(0, 100);
      expect(solver.solve().sizes.get('sidebar')).toBe(1300);

      dispose();
    });

    it('yields to the neighboring panel minimum', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 8,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'sidebar', minSize: 400 });
      solver.updatePanel('sidebar', {
        redistributionPreferredSize: 1200,
      });
      solver.addPanel({ id: 'content', minSize: 400 });

      expect(solver.solve().sizes.get('sidebar')).toBe(1192);
      expect(solver.solve().sizes.get('content')).toBe(400);

      dispose();
    });
  });

  describe('degenerate zone size', () => {
    it('shrinks panels together once free room is exhausted', async () => {
      const [size, setSize] = createSignal(2000);
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'A', minSize: 400 });
      solver.addPanel({ id: 'B', minSize: 400 });
      solver.addPanel({ id: 'C', minSize: 400 });

      // Drag the middle panel large: [400, 1200, 400].
      solver.moveHandle(0, -267);
      solver.moveHandle(1, 266);
      expect(solver.solve().sizes.get('B')).toBe(1200);

      // Shrinking the window below the summed minimums must crush all
      // panels together — not drain the large middle panel to zero while
      // its neighbors sit at their minimums.
      setSize(900);
      expect(solver.solve().sizes.get('A')).toBe(300);
      expect(solver.solve().sizes.get('B')).toBe(300);
      expect(solver.solve().sizes.get('C')).toBe(300);

      // Intent survives the crush: restoring the window restores the drag.
      setSize(2000);
      expect(solver.solve().sizes.get('A')).toBe(400);
      expect(solver.solve().sizes.get('B')).toBe(1200);
      expect(solver.solve().sizes.get('C')).toBe(400);

      dispose();
    });

    it('emits finite shares when the zone measures zero', async () => {
      const [size, setSize] = createSignal(1000);
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'A', minSize: 400 });
      solver.addPanel({ id: 'B', minSize: 400 });

      setSize(0);
      for (const share of solver.solve().shares.values()) {
        expect(Number.isFinite(share)).toBe(true);
      }

      setSize(1000);
      expect(solver.solve().sizes.get('A')).toBe(500);
      expect(solver.solve().sizes.get('B')).toBe(500);

      dispose();
    });

    it('keeps the share model through a transient too-small solve', async () => {
      const [size, setSize] = createSignal(1000);
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'A', minSize: 400 });
      solver.addPanel({ id: 'B', minSize: 400 });
      solver.moveHandle(0, 100);
      expect(solver.solve().sizes.get('A')).toBe(600);

      // The zone transiently measures smaller than the summed minimums
      // (e.g. mid-boot); restoring it must restore the prior proportions.
      setSize(300);
      setSize(1000);
      expect(solver.solve().sizes.get('A')).toBe(600);
      expect(solver.solve().sizes.get('B')).toBe(400);

      dispose();
    });

    it('holds a single split at full width when the zone measures zero', async () => {
      const [size, setSize] = createSignal(1000);
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'A', minSize: 400 });
      expect(solver.solve().sizes.get('A')).toBe(1000);

      // Zone momentarily reports 0 (unmeasured / hidden under a popover).
      setSize(0);
      expect(solver.solve().sizes.get('A')).toBe(1000);

      // A real measurement still re-solves normally.
      setSize(800);
      expect(solver.solve().sizes.get('A')).toBe(800);

      dispose();
    });
  });

  describe('canFitPanel', () => {
    it('accounts for the gutter added by the candidate panel', () => {
      createRoot((dispose) => {
        const [size, setSize] = createSignal(1215);
        const solver = createResizeSolver({
          direction: 'horizontal',
          gutter: () => 8,
          size,
          panels: [
            { id: 'A', minSize: 400 },
            { id: 'B', minSize: 400 },
          ],
        });

        expect(solver.canFitPanel({ id: 'C', minSize: 400 })).toBe(false);

        setSize(1216);
        expect(solver.canFitPanel({ id: 'C', minSize: 400 })).toBe(true);

        dispose();
      });
    });
  });
});
