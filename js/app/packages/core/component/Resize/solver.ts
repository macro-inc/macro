import { sumArray } from '@core/util/math';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  untrack,
} from 'solid-js';
import type { LayoutResult, Panel, PanelConfig, PanelId } from './types';

export type ResizeSolver = {
  readonly direction: 'horizontal' | 'vertical';
  addPanel: (panel: PanelConfig) => void;
  dropPanel: (id: PanelId) => void;
  solve: () => LayoutResult;
  reset: () => void;
  moveHandle: (index: number, delta: number) => void;
  order: () => PanelId[];
  hasPanel: (id: PanelId) => boolean;
  canFitPanel: (panel: PanelConfig) => boolean;
  hide: (id: PanelId) => void;
  show: (id: PanelId) => void;
  isHidden: (id: PanelId) => boolean;
};

const EPSILON = 1e-6;

function getUsable(panelCount: number, total: number, gutter: number) {
  return Math.max(0, total - Math.max(0, panelCount - 1) * gutter);
}

/**
 * Take the panels with their shares and compute the pixel dimensions with
 * constraints.
 * @param panels The panel array
 * @param total The total pixel size of the zone.
 * @param gutter The pixel gutter size
 * @returns A result with
 */
function computeFractionalShares(
  panels: Panel[],
  total: number,
  gutter: number
): LayoutResult {
  const n = panels.length;
  if (n === 0)
    return { sizes: new Map(), offsets: new Map(), shares: new Map() };
  const usable = getUsable(n, total, gutter);

  const desired = panels.map((p) => Math.max(0, Math.round(p.share * usable)));

  const clamped = [...desired];
  for (let i = 0; i < n; i++) {
    const min = panels[i].minSize ?? 0;
    const max = panels[i].maxSize ?? Infinity;
    clamped[i] = Math.min(Math.max(clamped[i], min), max);
  }

  const sumClamped = sumArray(clamped);
  let diff = usable - sumClamped;

  if (Math.abs(diff) > 0) {
    const free = new Array(n).fill(0).map((_, i) => {
      const min = panels[i].minSize ?? 0;
      const max = panels[i].maxSize ?? Infinity;
      return diff > 0 ? max - clamped[i] : clamped[i] - min;
    });
    let totalFree = free.reduce((a, b) => a + Math.max(0, b), 0);
    if (totalFree > 0) {
      for (let i = 0; i < n; i++) {
        const room = Math.max(0, free[i]);
        const take = Math.round((room / totalFree) * Math.abs(diff));
        if (Number.isFinite(take)) {
          clamped[i] += diff > 0 ? take : -take;
        }
      }
    }

    const finalSum = clamped.reduce((a, b) => a + b, 0);
    let tailFix = usable - finalSum;

    if (Math.abs(tailFix) > 0) {
      if (tailFix > 0) {
        // find panels that can grow
        for (let i = n - 1; i >= 0 && tailFix > 0; i--) {
          const max = panels[i].maxSize ?? Infinity;
          const canTake = Math.max(0, max - clamped[i]);
          const take = Math.min(tailFix, canTake);
          clamped[i] += take;
          tailFix -= take;
        }
      } else {
        // find panels that can shrink
        let remaining = -tailFix;
        for (let i = n - 1; i >= 0 && remaining > 0; i--) {
          const min = panels[i].minSize ?? 0;
          const canGive = Math.max(0, clamped[i] - min);
          const give = Math.min(remaining, canGive);
          clamped[i] -= give;
          remaining -= give;
        }

        if (remaining > 0) {
          const totalMinSizes = sumArray(panels.map((p) => p.minSize ?? 0));
          const containerTooSmall = usable < totalMinSizes;

          if (containerTooSmall) {
            let totalCurrentSize = sumArray(clamped);
            if (totalCurrentSize > 0) {
              for (let i = 0; i < n; i++) {
                const proportion = clamped[i] / totalCurrentSize;
                const shrinkAmount = Math.min(
                  remaining * proportion,
                  clamped[i]
                );
                clamped[i] -= shrinkAmount;
                remaining -= shrinkAmount;
              }
            }
          }
        }
      }
    }
  }

  const offsets = new Array(n).fill(0);
  const shares = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i >= 1) {
      offsets[i] = offsets[i - 1] + clamped[i - 1] + gutter;
    }
    shares[i] = clamped[i] / usable;
  }

  return {
    sizes: new Map(panels.map(({ id }, i) => [id, clamped[i]])),
    offsets: new Map(panels.map(({ id }, i) => [id, offsets[i]])),
    shares: new Map(panels.map(({ id }, i) => [id, shares[i]])),
  };
}

/** panel config -> panel with state */
function initPanel(panel: PanelConfig): Panel {
  return {
    ...panel,
    minSize: panel.minSize ?? 0,
    maxSize: panel.maxSize ?? Infinity,
    target: panel.target || { kind: 'auto' },
    share: 0,
  };
}

/**
 * Create the internal-hiding business logic for a resize Zone.
 * @param params
 * @returns
 */
export function createResizeSolver(params: {
  direction: 'horizontal' | 'vertical';
  gutter: Accessor<number>;
  size: Accessor<number>;
  panels: PanelConfig[];
}): ResizeSolver {
  const panelData: Record<PanelId, Panel> = Object.fromEntries(
    params.panels.map((panel) => [panel.id, initPanel(panel)])
  );

  // the panel ids in order - main signal.
  const [order, setOrder] = createSignal(params.panels.map((p) => p.id));

  // set of hidden panel ids
  const [hiddenPanels, setHiddenPanels] = createSignal<Set<PanelId>>(new Set());

  // counter manually manages reactivity, rather than a store on panel data -
  // whose side effects become a pain.
  const [counter, setCounter] = createSignal(0);
  const setDirty = () => setCounter((p) => p + 1);

  const panelsInOrder = () => {
    counter(); // deps
    const hidden = hiddenPanels();
    return order()
      .filter((id) => !hidden.has(id))
      .map((id, i) => {
        const panel = panelData[id];
        if (!panel) {
          throw new Error(
            `Critical layout error. panel store does not have id ${id} at index ${i}`
          );
        }
        return panel;
      });
  };

  // the layout signal that components actually read from
  const [layout, setLayout] = createSignal<LayoutResult>({
    shares: new Map(),
    sizes: new Map(),
    offsets: new Map(),
  });

  // the solve on dependencies effect
  createEffect(() => {
    const ps = panelsInOrder();

    // run the solve to get pixel values
    const solve = computeFractionalShares(ps, params.size(), params.gutter());

    // basically update the float share values to match the actual pixel sizes returned by the solve.
    const ids = order();
    const n = ids.length;
    const usable = getUsable(n, params.size(), params.gutter());
    if (usable > 0 && n > 0) {
      const clampedPx = ids.map((id) => solve.sizes.get(id) ?? 0);
      const mins = ps.map((p) => p.minSize ?? 0);
      const maxs = ps.map((p) => p.maxSize ?? Infinity);

      const free: number[] = [];
      const clamped: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = clampedPx[i];
        if (x > mins[i] + EPSILON && x < maxs[i] - EPSILON) free.push(i);
        else clamped.push(i);
      }

      for (const i of clamped) {
        panelData[ids[i]].share = clampedPx[i] / usable;
      }

      const sumModelFree = sumArray(free.map((i) => panelData[ids[i]].share));
      const sumPxFree = sumArray(free.map((i) => clampedPx[i])) / usable;

      if (free.length > 0) {
        if (sumModelFree > 0) {
          const k = sumPxFree / sumModelFree;
          for (const i of free) panelData[ids[i]].share *= k;
        } else {
          const eq = sumPxFree / free.length;
          for (const i of free) panelData[ids[i]].share = eq;
        }
      }

      // account for floating point drift
      const sum = sumArray(ids.map((id) => panelData[id].share));
      if (sum > 0 && Math.abs(sum - 1) > EPSILON) {
        for (const id of ids) panelData[id].share /= sum;
      }
    }

    setLayout(solve);
  });

  function addPanel(panel: PanelConfig, ndx?: number) {
    batch(() => {
      if (panel.id in panelData) return;

      const ids = untrack(order);
      const length = ids.length;
      const nextLength = length + 1;

      let index = ndx && ndx < order().length ? ndx : order().length;

      // default is the "equal size" share
      let incomingShare = 1 / nextLength;

      // check max size constraint
      if (length > 0) {
        const usableSize = getUsable(
          nextLength,
          params.size(),
          params.gutter()
        );

        if (usableSize > 0) {
          const equalPx = usableSize / nextLength;
          const maxPx = panel.maxSize ?? Infinity;
          if (maxPx < equalPx) {
            incomingShare = Math.min(maxPx / usableSize, 1 / nextLength);
          }
        }
      }

      panelData[panel.id] = {
        ...initPanel(panel),
        share: incomingShare,
      };

      for (const id of ids) {
        const prevShare = untrack(() => panelData[id].share ?? 1);
        panelData[id].share = prevShare * (1 - incomingShare);
      }

      if (index >= order().length) {
        setOrder((prev) => [...prev, panel.id]);
      } else {
        setOrder((prev) => [
          ...prev.slice(0, index),
          panel.id,
          ...prev.slice(index),
        ]);
      }
      setDirty();
    });
  }

  function dropPanel(id: PanelId) {
    batch(() => {
      const ids = untrack(order);
      const length = ids.length;
      const nextIds = ids.filter((x) => x !== id);
      const nextLength = nextIds.length;
      if (length === nextLength) return;

      const sum = sumArray(
        nextIds.map((id) => untrack(() => panelData[id]?.share ?? 0))
      );
      if (sum > 0 && Number.isFinite(sum)) {
        for (const id of nextIds) {
          const s = panelData[id]?.share ?? 0;
          const newShare = s / sum;
          if (Number.isFinite(newShare)) {
            panelData[id].share = newShare;
          }
        }
      } else if (nextLength > 0) {
        const equalShare = 1 / nextLength;
        for (const id of nextIds) {
          panelData[id].share = equalShare;
        }
      }
      delete panelData[id];
      setOrder(nextIds);
      setDirty();
    });
  }

  function moveHandle(ndx: number, deltaPx: number) {
    const ids = order();
    const n = ids.length;
    if (ndx < 0 || ndx >= n - 1) return;

    const panels = panelsInOrder();
    const usable = Math.max(
      0,
      params.size() - Math.max(0, n - 1) * params.gutter()
    );
    if (usable <= 0) return;

    // +dShare => handle right: left grows, right stack shrinks
    // -dShare => handle left: left stack shrinks, right grows
    const dShare = deltaPx / usable;
    if (!Number.isFinite(dShare) || dShare === 0) return;

    const L = ndx;
    const R = ndx + 1;

    const shares = ids.map((id) => panelData[id]!.share);

    const bounds = (i: number) => {
      const minPx = panels[i].minSize ?? 0;
      const maxPx = panels[i].maxSize ?? Infinity;
      const minS = Math.max(0, minPx / usable);
      const maxS = Number.isFinite(maxPx) ? maxPx / usable : 1;
      return [minS, maxS] as const;
    };

    const growCap = (i: number) => {
      const [, maxS] = bounds(i);
      return Math.max(0, maxS - shares[i]);
    };

    const shrinkCapLeftStack = () => {
      let cap = 0;
      for (let i = L; i >= 0; i--) {
        const [minS] = bounds(i);
        cap += Math.max(0, shares[i] - minS);
      }
      return cap;
    };

    const shrinkCapRightStack = () => {
      let cap = 0;
      for (let i = R; i < n; i++) {
        const [minS] = bounds(i);
        cap += Math.max(0, shares[i] - minS);
      }
      return cap;
    };

    if (dShare < 0) {
      // Move LEFT: shrink LEFT stack, grow RIGHT (R only)
      const req = -dShare;
      const capShrinkLeft = shrinkCapLeftStack();
      const capGrowR = growCap(R);
      const applied = Math.min(req, capShrinkLeft, capGrowR);
      if (applied <= 0) return;

      const newShares = shares.slice();
      // shrink from the handle outward: L, L-1, L-2, ...
      let remain = applied;
      for (let i = L; i >= 0 && remain > EPSILON; i--) {
        const [minS] = bounds(i);
        const take = Math.min(newShares[i] - minS, remain);
        if (take > 0) {
          newShares[i] -= take;
          remain -= take;
        }
      }
      // grow immediate right neighbor only
      newShares[R] += applied;

      for (let i = 0; i < n; i++) {
        panelData[ids[i]].share = newShares[i];
      }
    } else {
      // dShare > 0: Move RIGHT: shrink RIGHT stack, grow LEFT (L only)
      const req = dShare;
      const capShrinkRight = shrinkCapRightStack();
      const capGrowL = growCap(L);
      const applied = Math.min(req, capShrinkRight, capGrowL);
      if (applied <= 0) return;

      const newShares = shares.slice();
      let remain = applied;
      for (let i = R; i < n && remain > EPSILON; i++) {
        const [minS] = bounds(i);
        const take = Math.min(newShares[i] - minS, remain);
        if (take > 0) {
          newShares[i] -= take;
          remain -= take;
        }
      }
      newShares[L] += applied;

      for (let i = 0; i < n; i++) {
        panelData[ids[i]].share = newShares[i];
      }
    }

    const sum = sumArray(ids.map((id) => panelData[id]?.share ?? 0));
    if (Math.abs(sum - 1) > EPSILON && sum > 0 && Number.isFinite(sum)) {
      for (const id of ids) {
        panelData[id].share = panelData[id].share / sum;
      }
    }

    setDirty();
  }

  return {
    direction: params.direction,
    addPanel,
    dropPanel,
    solve: layout,
    reset: () => {
      const panels = panelsInOrder();
      const n = panels.length;
      for (const panel of panels) {
        panelData[panel.id].share = 1 / n;
      }
      setDirty();
    },
    order,
    moveHandle,
    hasPanel: (id: PanelId) => {
      return order().includes(id) && id in panelData;
    },
    canFitPanel: (panel: PanelConfig) => {
      const currentPanels = panelsInOrder();
      const n = currentPanels.length;
      const usable = getUsable(n, params.size(), params.gutter());
      if (usable <= 0) return false;
      const minSum = sumArray(currentPanels.map((p) => p.minSize ?? 0));
      const totalMinRequired = minSum + (panel.minSize ?? 0);
      return totalMinRequired <= usable;
    },
    hide: (id: PanelId) => {
      if (!panelData[id] || hiddenPanels().has(id)) return;

      batch(() => {
        const currentHidden = hiddenPanels();
        const newHidden = new Set(currentHidden);
        newHidden.add(id);
        setHiddenPanels(newHidden);
        setDirty();
      });
    },
    show: (id: PanelId) => {
      if (!panelData[id] || !hiddenPanels().has(id)) return;

      batch(() => {
        const currentHidden = hiddenPanels();
        const newHidden = new Set(currentHidden);
        newHidden.delete(id);
        setHiddenPanels(newHidden);
        setDirty();
      });
    },
    isHidden: (id: PanelId) => {
      return hiddenPanels().has(id);
    },
  };
}
