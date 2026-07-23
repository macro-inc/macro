import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createResizeSolver } from './solver';

describe('createResizeSolver', () => {
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

      solver.addPanel({ id: 'controller', minSize: 100 });
      solver.updatePanel('controller', {
        redistributionPreferredSize: 440,
      });
      expect(solver.solve().sizes.get('controller')).toBe(1600);

      solver.addPanel({ id: 'viewer', minSize: 100 });
      expect(solver.solve().sizes.get('controller')).toBe(440);

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

      solver.addPanel({ id: 'controller', minSize: 100 });
      solver.addPanel({ id: 'viewer', minSize: 100 });
      solver.addPanel({ id: 'adjacent', minSize: 100 });
      solver.updatePanel('controller', { redistributionPreferredSize: 440 });

      expect(solver.solve().sizes.get('controller')).toBe(440);

      solver.moveHandle(0, 160);
      expect(solver.solve().sizes.get('controller')).toBe(600);

      solver.dropPanel('adjacent');
      expect(solver.solve().sizes.get('controller')).toBe(440);

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

      solver.addPanel({ id: 'controller', minSize: 400 });
      solver.updatePanel('controller', {
        redistributionPreferredSize: 1200,
      });
      solver.addPanel({ id: 'viewer', minSize: 400 });

      expect(solver.solve().sizes.get('controller')).toBe(1200);

      solver.moveHandle(0, 100);
      expect(solver.solve().sizes.get('controller')).toBe(1300);

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

      solver.addPanel({ id: 'controller', minSize: 400 });
      solver.updatePanel('controller', {
        redistributionPreferredSize: 1200,
      });
      solver.addPanel({ id: 'viewer', minSize: 400 });

      expect(solver.solve().sizes.get('controller')).toBe(1192);
      expect(solver.solve().sizes.get('viewer')).toBe(400);

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
