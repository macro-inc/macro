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

    it('moves all contiguous members of a share group together', async () => {
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
      solver.addPanel({ id: 'B', minSize: 0, shareGroup: 'pair' });
      solver.addPanel({ id: 'C', minSize: 0, shareGroup: 'pair' });
      solver.addPanel({ id: 'D', minSize: 0 });
      await Promise.resolve();

      solver.swap('B', 'D');

      expect(solver.order()).toEqual(['A', 'D', 'B', 'C']);

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

  describe('shareGroup', () => {
    it('carves a joining member share from its group, leaving other units alone', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      expect(solver.solve().sizes.get('doc')).toBe(800);

      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(400);
      expect(solver.solve().sizes.get('viewer')).toBe(400);

      dispose();
    });

    it('returns a departing member share to its group', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });

      solver.dropPanel('viewer');
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(800);

      dispose();
    });

    it('counts a group as one unit when a standalone panel is added', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'doc', minSize: 100 });

      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(400);
      expect(solver.solve().sizes.get('viewer')).toBe(400);

      dispose();
    });

    it('settles a redistribution preference within the group', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });
      solver.updatePanel('controller', { redistributionPreferredSize: 440 });

      // The pin trades space with the viewer; the document keeps 50%.
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(440);
      expect(solver.solve().sizes.get('viewer')).toBe(360);

      dispose();
    });

    it('yields the pin to its unit budget when group-mates cannot fund it', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 400 });
      solver.addPanel({ id: 'controller', minSize: 400, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 400, shareGroup: 'pair' });
      solver.updatePanel('controller', { redistributionPreferredSize: 440 });

      // The viewer sits at its minimum, so the pair cannot fund the pin:
      // it shrinks back to the unit's budget instead of taking from the
      // document.
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(400);
      expect(solver.solve().sizes.get('viewer')).toBe(400);

      dispose();
    });

    it('keeps singles at equal unit shares when a split is added beside a pair', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'L', minSize: 400 });
      solver.addPanel({ id: 'controller', minSize: 340, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 400, shareGroup: 'pair' });
      solver.updatePanel('controller', { redistributionPreferredSize: 440 });

      // "New split right": three units intend a third each. The zone is too
      // tight to honor that (the pair's hard minimums are 340 + 400), but
      // the singles stay EQUAL and the pair only exceeds a third by its
      // minimums — the unfunded pin may not push the singles further down.
      solver.addPanel({ id: 'new', minSize: 400 });
      expect(solver.solve().sizes.get('L')).toBe(430);
      expect(solver.solve().sizes.get('new')).toBe(430);
      expect(solver.solve().sizes.get('controller')).toBe(340);
      expect(solver.solve().sizes.get('viewer')).toBe(400);

      dispose();
    });

    it('absorbs the group gutter so other panels never shift on join/leave', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 8,
          size: () => 1608,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      expect(solver.solve().sizes.get('doc')).toBe(800);

      // The viewer's gutter comes out of the pair, not the other panels.
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(396);
      expect(solver.solve().sizes.get('viewer')).toBe(396);

      solver.updatePanel('controller', { redistributionPreferredSize: 440 });
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(440);
      expect(solver.solve().sizes.get('viewer')).toBe(352);

      // Disengage clears the preference alongside the drop (in the app both
      // land in one reactive flush); leaving then reclaims the gutter for
      // an exact round-trip.
      solver.updatePanel('controller', {
        redistributionPreferredSize: undefined,
      });
      expect(solver.solve().sizes.get('doc')).toBe(800);
      solver.dropPanel('viewer');
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(800);

      dispose();
    });

    it('keeps unit shares stable across zone resizes', async () => {
      const [size, setSize] = createSignal(1600);
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

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });
      solver.updatePanel('controller', { redistributionPreferredSize: 440 });

      expect(solver.solve().sizes.get('doc')).toBe(800);

      // Growing the zone keeps the document at half; the pinned controller
      // stays put and its group-mate absorbs the pair's growth.
      setSize(2000);
      expect(solver.solve().sizes.get('doc')).toBe(1000);
      expect(solver.solve().sizes.get('controller')).toBe(440);
      expect(solver.solve().sizes.get('viewer')).toBe(560);

      dispose();
    });

    it('routes gutter-drag growth past the controller preferred size to the viewer', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });
      solver.updatePanel('controller', { redistributionPreferredSize: 440 });
      expect(solver.solve().sizes.get('doc')).toBe(800);

      // Shrinking the document leaves the controller at its preferred
      // width; the freed space flows to the viewer.
      solver.moveHandle(0, -200);
      expect(solver.solve().sizes.get('doc')).toBe(600);
      expect(solver.solve().sizes.get('controller')).toBe(440);
      expect(solver.solve().sizes.get('viewer')).toBe(560);

      // Dragging the pair's own internal gutter still resizes the
      // controller directly.
      solver.moveHandle(1, 100);
      expect(solver.solve().sizes.get('controller')).toBe(540);
      expect(solver.solve().sizes.get('viewer')).toBe(460);

      dispose();
    });

    it('takes gutter-drag shrink from the viewer before the controller', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });
      solver.updatePanel('controller', { redistributionPreferredSize: 440 });

      // Growing the document squeezes the viewer while the controller
      // holds its preferred width...
      solver.moveHandle(0, 200);
      expect(solver.solve().sizes.get('doc')).toBe(1000);
      expect(solver.solve().sizes.get('controller')).toBe(440);
      expect(solver.solve().sizes.get('viewer')).toBe(160);

      // ...and only once the viewer bottoms out does the controller give.
      solver.moveHandle(0, 200);
      expect(solver.solve().sizes.get('doc')).toBe(1200);
      expect(solver.solve().sizes.get('controller')).toBe(300);
      expect(solver.solve().sizes.get('viewer')).toBe(100);

      dispose();
    });

    it('restores per-unit distribution when a split closes from a min-crushed layout', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 8,
          size: () => 1704,
          panels: [],
        }),
      }));

      await Promise.resolve();

      // [L | pair(C+V) | R] in a zone where the pair's floor (440 + 400)
      // forces everything else onto its minimums.
      solver.addPanel({ id: 'L', minSize: 400 });
      solver.addPanel({ id: 'C', minSize: 340, shareGroup: 'pair' });
      solver.updatePanel('C', { redistributionPreferredSize: 440 });
      solver.addPanel({ id: 'V', minSize: 400, shareGroup: 'pair' });
      solver.addPanel({ id: 'R', minSize: 400 });

      // Rendering is constraint-dictated: L is crushed below its intent by
      // the pair's hard minimums (the unfunded pin has already yielded).
      expect(solver.solve().sizes.get('L')).toBe(471);
      expect(solver.solve().sizes.get('C')).toBe(340);
      expect(solver.solve().sizes.get('V')).toBe(400);
      expect(solver.solve().sizes.get('R')).toBe(469);

      // Closing R must distribute per UNIT: the crushed pixels carry no
      // intent, so L returns to half the zone and the pair takes the other
      // half — not two-thirds to the pair's two panels.
      solver.dropPanel('R');
      expect(solver.solve().sizes.get('L')).toBe(848);
      expect(solver.solve().sizes.get('C')).toBe(440);
      expect(solver.solve().sizes.get('V')).toBe(400);

      dispose();
    });

    it('resets to an equal share per unit', async () => {
      const { solver, dispose } = createRoot((dispose) => ({
        dispose,
        solver: createResizeSolver({
          direction: 'horizontal',
          gutter: () => 0,
          size: () => 1600,
          panels: [],
        }),
      }));

      await Promise.resolve();

      solver.addPanel({ id: 'doc', minSize: 100 });
      solver.addPanel({ id: 'controller', minSize: 100, shareGroup: 'pair' });
      solver.addPanel({ id: 'viewer', minSize: 100, shareGroup: 'pair' });

      solver.moveHandle(0, -400);
      expect(solver.solve().sizes.get('doc')).toBe(400);

      solver.reset();
      expect(solver.solve().sizes.get('doc')).toBe(800);
      expect(solver.solve().sizes.get('controller')).toBe(400);
      expect(solver.solve().sizes.get('viewer')).toBe(400);

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
