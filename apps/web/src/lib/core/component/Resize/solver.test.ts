import { createRoot } from 'solid-js';
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
});
