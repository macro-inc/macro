import { sumArray } from '@core/util/math';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  untrack,
} from 'solid-js';
import type { LayoutResult, Panel, PanelConfig, PanelId } from './types';

type ResizeSolver = {
  readonly direction: 'horizontal' | 'vertical';
  addPanel: (panel: PanelConfig, index?: number) => void;
  dropPanel: (id: PanelId) => void;
  updatePanel: (
    id: PanelId,
    config: {
      minSize?: number;
      maxSize?: number;
      redistributionPreferredSize?: number;
      shareGroup?: string;
    }
  ) => void;
  solve: () => LayoutResult;
  reset: () => void;
  moveHandle: (index: number, delta: number) => void;
  order: () => PanelId[];
  hasPanel: (id: PanelId) => boolean;
  canFitPanel: (panel: Partial<PanelConfig>) => boolean;
  swap: (firstId: PanelId, secondId: PanelId) => void;
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
        // Cap each take at the panel's own room: when the total diff
        // exceeds the total free room, an uncapped take would push the
        // panel past its min/max (a large panel could hit zero width while
        // its neighbors sit at their minimums). The capped remainder falls
        // through to the too-small handling below, which shrinks every
        // panel together.
        const take = Math.min(
          room,
          Math.round((room / totalFree) * Math.abs(diff))
        );
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
            // Below the summed minimums nothing has room left to give, so
            // every panel shrinks together by the same factor — sizes stay
            // proportional to the minimums and always sum to the usable
            // space.
            const totalCurrentSize = sumArray(clamped);
            if (totalCurrentSize > 0) {
              const scale = usable / totalCurrentSize;
              for (let i = 0; i < n; i++) {
                clamped[i] *= scale;
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
    // A zero-measure zone (e.g. mid-boot) must not emit NaN shares into
    // the layout result consumers read.
    shares[i] = usable > 0 ? clamped[i] / usable : 0;
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
 * Panels with the same `shareGroup` form one layout unit; every ungrouped
 * panel is a unit of its own. Automatic share allocation is per unit, so a
 * group collectively receives the space a single panel would.
 */
function countUnits(panels: readonly Pick<Panel, 'shareGroup'>[]): number {
  const groups = new Set<string>();
  let units = 0;
  for (const panel of panels) {
    if (panel.shareGroup === undefined) {
      units += 1;
    } else if (!groups.has(panel.shareGroup)) {
      groups.add(panel.shareGroup);
      units += 1;
    }
  }
  return units;
}

/**
 * Pin automatic-layout preferences when the remaining panels can absorb the
 * leftover space. Preferences yield to every panel's minimum size, while
 * manual resize solves ignore them entirely.
 */
function applyRedistributionPreferences(
  panels: Panel[],
  usable: number
): Panel[] {
  if (usable <= 0) return panels;

  const preferredPanels = panels.flatMap((panel) => {
    const preferred = panel.redistributionPreferredSize;
    if (preferred === undefined || !Number.isFinite(preferred)) return [];
    const size = Math.min(Math.max(preferred, panel.minSize), panel.maxSize);
    return [{ panel, size }];
  });
  if (preferredPanels.length === 0) return panels;

  const preferredIds = new Set(preferredPanels.map(({ panel }) => panel.id));
  const remainingPanels = panels.filter((panel) => !preferredIds.has(panel.id));
  const remainingMin = sumArray(remainingPanels.map((panel) => panel.minSize));
  const availableForPreferred = usable - remainingMin;
  const preferredMin = sumArray(
    preferredPanels.map(({ panel }) => panel.minSize)
  );
  if (availableForPreferred + EPSILON < preferredMin) return panels;

  const preferredTotal = sumArray(preferredPanels.map(({ size }) => size));
  const overflow = Math.max(0, preferredTotal - availableForPreferred);
  if (overflow > 0) {
    const shrinkable = sumArray(
      preferredPanels.map(({ panel, size }) => size - panel.minSize)
    );
    if (shrinkable > 0) {
      for (const target of preferredPanels) {
        const room = target.size - target.panel.minSize;
        target.size -= overflow * (room / shrinkable);
      }
    }
  }

  const resolvedPreferredTotal = sumArray(
    preferredPanels.map(({ size }) => size)
  );
  const remainingMax = sumArray(remainingPanels.map((panel) => panel.maxSize));
  // Avoid leaving a gap when no other panel can absorb the remaining space.
  if (resolvedPreferredTotal + remainingMax + EPSILON < usable) return panels;

  // Settle a pinned panel's size delta within its share group first: the
  // group is one layout unit, so pinning one member trades space with its
  // group-mates and leaves the other units' sizes alone. Whatever the
  // group-mates cannot fund shrinks the pin itself (down to the panel's
  // hard minimum) instead of taking space from other units. Hard minimums
  // always still leak to the global solve.
  const shareAdjustments = new Map<PanelId, number>();
  const adjustedShare = (panel: Panel) =>
    panel.share + (shareAdjustments.get(panel.id) ?? 0);
  for (const entry of preferredPanels) {
    const { panel, size } = entry;
    if (panel.shareGroup === undefined) continue;
    const groupMates = panels.filter(
      (candidate) =>
        candidate.shareGroup === panel.shareGroup &&
        candidate.id !== panel.id &&
        !preferredIds.has(candidate.id)
    );
    if (groupMates.length === 0) continue;

    const delta = size / usable - panel.share;
    if (delta > EPSILON) {
      // The pin grows the panel: group-mates give up share, weighted by
      // their room above minimum.
      const capacities = groupMates.map((mate) =>
        Math.max(0, adjustedShare(mate) - mate.minSize / usable)
      );
      const totalCapacity = sumArray(capacities);
      const applied = Math.min(delta, totalCapacity);
      if (totalCapacity > 0 && applied > 0) {
        groupMates.forEach((mate, i) => {
          const give = applied * (capacities[i] / totalCapacity);
          shareAdjustments.set(
            mate.id,
            (shareAdjustments.get(mate.id) ?? 0) - give
          );
        });
      }
      const unfunded = delta - applied;
      if (unfunded > EPSILON) {
        entry.size = Math.max(panel.minSize, (panel.share + applied) * usable);
      }
    } else if (delta < -EPSILON) {
      // The pin shrinks the panel: group-mates receive the freed share,
      // weighted by their current shares.
      const weights = groupMates.map((mate) =>
        Math.max(0, adjustedShare(mate))
      );
      const totalWeight = sumArray(weights);
      groupMates.forEach((mate, i) => {
        const weight =
          totalWeight > 0 ? weights[i] / totalWeight : 1 / groupMates.length;
        shareAdjustments.set(
          mate.id,
          (shareAdjustments.get(mate.id) ?? 0) + -delta * weight
        );
      });
    }
  }

  const preferredSizeById = new Map(
    preferredPanels.map(({ panel, size }) => [panel.id, size])
  );
  return panels.map((panel) => {
    const preferred = preferredSizeById.get(panel.id);
    if (preferred !== undefined) {
      return {
        ...panel,
        minSize: preferred,
        maxSize: preferred,
        share: preferred / usable,
      };
    }
    const adjustment = shareAdjustments.get(panel.id);
    return adjustment === undefined
      ? panel
      : { ...panel, share: Math.max(0, panel.share + adjustment) };
  });
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
  let nextSolveKind: 'automatic' | 'manual' = 'automatic';
  const setDirty = (kind: 'automatic' | 'manual' = 'automatic') => {
    nextSolveKind = kind;
    setCounter((p) => p + 1);
  };

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

  // The solve on dependencies effect.
  //
  // Shares are INTENT: they record how the user wants space divided between
  // layout units, and only unit arithmetic (panels joining/leaving) and
  // manual gutter drags write them. A solve renders intent under the current
  // constraints (minimums, pins) but NEVER writes the result back — solved
  // pixels in a tight zone are constraint-dictated and carry no intent, and
  // baking them in would permanently distort the model (e.g. a min-crushed
  // Preview Pair would keep its crushed proportions after space frees up).
  createEffect(() => {
    const ps = panelsInOrder();
    const zoneSize = params.size();
    const gutter = params.gutter();

    // A zero (or negative) zone size means it's unmeasured or hidden. Solving
    // against it collapses every panel to zero, and since the observer may not
    // fire again that sticks. Keep the last good layout, and leave the pending
    // solve kind untouched so it still applies on the next real solve.
    if (zoneSize <= 0) return;

    const solveKind = nextSolveKind;
    nextSolveKind = 'automatic';

    const usable = getUsable(ps.length, zoneSize, gutter);
    const solvePanels =
      solveKind === 'automatic'
        ? applyRedistributionPreferences(ps, usable)
        : ps;

    setLayout(computeFractionalShares(solvePanels, zoneSize, gutter));
  });

  function addPanel(panel: PanelConfig, ndx?: number) {
    batch(() => {
      if (panel.id in panelData) return;

      const ids = untrack(order);
      const length = ids.length;
      const nextLength = length + 1;

      let index = ndx != null && ndx < order().length ? ndx : order().length;

      const usableSize = getUsable(nextLength, params.size(), params.gutter());

      // A panel joining a live share group carves its share out of the
      // group's members: the group is one layout unit, so the other units
      // keep their sizes. The group also absorbs the gutter the new panel
      // introduces — usable space shrinks by one gutter, so without the
      // correction every other panel would shift by its slice of it.
      const groupMemberIds =
        panel.shareGroup === undefined
          ? []
          : ids.filter((id) => panelData[id].shareGroup === panel.shareGroup);
      if (groupMemberIds.length > 0) {
        const memberIdSet = new Set(groupMemberIds);
        const groupShare = sumArray(
          groupMemberIds.map((id) => panelData[id].share)
        );
        const usableBefore = getUsable(length, params.size(), params.gutter());
        const memberScale = groupMemberIds.length / (groupMemberIds.length + 1);
        let incomingGroupShare = groupShare;
        if (usableBefore > 0 && usableSize > 0) {
          const nextGroupShare = Math.max(
            0,
            (groupShare * usableBefore - params.gutter()) / usableSize
          );
          const rescale = usableBefore / usableSize;
          const groupRescale = groupShare > 0 ? nextGroupShare / groupShare : 0;
          for (const id of ids) {
            panelData[id].share *= memberIdSet.has(id)
              ? groupRescale * memberScale
              : rescale;
          }
          incomingGroupShare = nextGroupShare;
        } else {
          // Zone size unknown: fall back to a plain within-group carve.
          for (const id of groupMemberIds) {
            panelData[id].share *= memberScale;
          }
        }
        panelData[panel.id] = {
          ...initPanel(panel),
          share: incomingGroupShare / (groupMemberIds.length + 1),
        };

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
        return;
      }

      // Calculate incoming share based on target spec, defaulting to an
      // equal share per layout unit (a share group counts as one unit).
      let incomingShare = 1 / (countUnits(ids.map((id) => panelData[id])) + 1);

      if (panel.target && usableSize > 0) {
        switch (panel.target.kind) {
          case 'percent':
            incomingShare = panel.target.percent / 100;
            break;
          case 'px':
            incomingShare = panel.target.px / usableSize;
            break;
          case 'fr':
            // fr needs total fr units across all panels - not supported yet, use equal
            break;
          default:
            // keep equal share
            break;
        }
      }

      // Clamp to max size constraint
      if (length > 0 && usableSize > 0) {
        const maxPx = panel.maxSize ?? Infinity;
        const maxShare = maxPx / usableSize;
        incomingShare = Math.min(incomingShare, maxShare);
      }

      // Clamp share to [0, 1] for sanity
      incomingShare = Math.max(0, Math.min(1, incomingShare));

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

  function updatePanel(
    id: PanelId,
    config: {
      minSize?: number;
      maxSize?: number;
      redistributionPreferredSize?: number;
      shareGroup?: string;
    }
  ) {
    const panel = panelData[id];
    if (!panel) return;
    let changed = false;
    if ('minSize' in config) {
      const next = config.minSize ?? 0;
      if (panel.minSize !== next) {
        panel.minSize = next;
        changed = true;
      }
    }
    if ('maxSize' in config) {
      const next = config.maxSize ?? Infinity;
      if (panel.maxSize !== next) {
        panel.maxSize = next;
        changed = true;
      }
    }
    if ('redistributionPreferredSize' in config) {
      const next = config.redistributionPreferredSize;
      if (panel.redistributionPreferredSize !== next) {
        panel.redistributionPreferredSize = next;
        changed = true;
      }
    }
    if ('shareGroup' in config) {
      // Membership alone moves no pixels, so it does not dirty the layout;
      // it only informs future share allocation.
      panel.shareGroup = config.shareGroup;
    }
    if (changed) setDirty();
  }

  function dropPanel(id: PanelId) {
    batch(() => {
      const ids = untrack(order);
      const length = ids.length;
      const nextIds = ids.filter((x) => x !== id);
      const nextLength = nextIds.length;
      if (length === nextLength) return;

      // A departing group member leaves its share to the rest of its group,
      // so the group keeps its overall size and other units are unaffected.
      // The group also reclaims the gutter the departing panel frees —
      // mirroring the join-time absorption — so other panels' pixel widths
      // survive an engage/disengage round-trip exactly. The proportional
      // renormalization below then only fixes drift.
      const dropped = panelData[id];
      const groupMemberIds =
        dropped?.shareGroup === undefined
          ? []
          : nextIds.filter(
              (x) => panelData[x]?.shareGroup === dropped.shareGroup
            );
      if (groupMemberIds.length > 0 && dropped.share > 0) {
        const memberSum = sumArray(
          groupMemberIds.map((x) => panelData[x].share)
        );
        const usableBefore = getUsable(length, params.size(), params.gutter());
        const usableAfter = getUsable(
          nextLength,
          params.size(),
          params.gutter()
        );
        if (usableBefore > 0 && usableAfter > 0) {
          const groupShare = memberSum + dropped.share;
          const nextGroupShare =
            (groupShare * usableBefore + params.gutter()) / usableAfter;
          const rescale = usableBefore / usableAfter;
          const memberIdSet = new Set(groupMemberIds);
          for (const x of nextIds) {
            if (!memberIdSet.has(x)) panelData[x].share *= rescale;
          }
          for (const x of groupMemberIds) {
            const weight =
              memberSum > 0
                ? panelData[x].share / memberSum
                : 1 / groupMemberIds.length;
            panelData[x].share = nextGroupShare * weight;
          }
        } else {
          // Zone size unknown: fall back to a plain within-group hand-off.
          for (const x of groupMemberIds) {
            const weight =
              memberSum > 0
                ? panelData[x].share / memberSum
                : 1 / groupMemberIds.length;
            panelData[x].share += dropped.share * weight;
          }
        }
      }

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

    // Drags anchor to the RENDERED layout (what the user sees), which can
    // differ from the intent shares when constraints or pins are active.
    // The dragged result is then written back as the new intent below —
    // manual resizing is the one interaction that redefines intent from
    // rendered reality.
    const rendered = untrack(layout).shares;
    const shares = ids.map((id) => rendered.get(id) ?? panelData[id]!.share);

    const bounds = (i: number) => {
      if (i < 0 || i >= panels.length) return [0, 0];
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

    /**
     * The preferred share a grouped panel soft-pins to during gutter drags,
     * or undefined for panels without one.
     */
    const preferredShare = (i: number): number | undefined => {
      const panel = panels[i];
      const preferred = panel.redistributionPreferredSize;
      if (
        panel.shareGroup === undefined ||
        preferred === undefined ||
        !Number.isFinite(preferred)
      ) {
        return undefined;
      }
      const px = Math.min(Math.max(preferred, panel.minSize), panel.maxSize);
      return px / usable;
    };

    /** Contiguous group-mates of panel `i`, walking in direction `dir`. */
    const matesBeyond = (i: number, dir: 1 | -1): number[] => {
      const group = panels[i].shareGroup;
      if (group === undefined) return [];
      const mates: number[] = [];
      for (
        let j = i + dir;
        j >= 0 && j < n && panels[j].shareGroup === group;
        j += dir
      ) {
        mates.push(j);
      }
      return mates;
    };

    /**
     * Grow capacity of the handle's neighbor, including group-mates behind
     * it when growth cascades past a preferred size (see growFrom).
     */
    const growCapFrom = (i: number, dir: 1 | -1) => {
      const mates = preferredShare(i) === undefined ? [] : matesBeyond(i, dir);
      return growCap(i) + sumArray(mates.map(growCap));
    };

    /**
     * Grow the handle's neighbor `i` by `amount`. A grouped panel with a
     * preferred size (a preview Controller) soft-caps at that preferred size: overflow flows
     * to its group-mates beyond it (its Viewer) rather than growing it past
     * its configured width. Dragging the group's own internal gutter is
     * unaffected — there the mates sit on the handle side, so the neighbor
     * grows directly.
     */
    const growFrom = (
      newShares: number[],
      i: number,
      dir: 1 | -1,
      amount: number
    ) => {
      const preferred = preferredShare(i);
      const mates = preferred === undefined ? [] : matesBeyond(i, dir);
      if (preferred === undefined || mates.length === 0) {
        newShares[i] += amount;
        return;
      }
      const softCap = Math.max(preferred, newShares[i]);
      const direct = Math.min(amount, Math.max(0, softCap - newShares[i]));
      newShares[i] += direct;
      let remain = amount - direct;
      for (const j of mates) {
        if (remain <= EPSILON) break;
        const [, maxS] = bounds(j);
        const take = Math.min(remain, Math.max(0, maxS - newShares[j]));
        newShares[j] += take;
        remain -= take;
      }
      // Group-mates saturated: the rest lands on the neighbor after all.
      newShares[i] += remain;
    };

    /**
     * Shrink the stack starting at `from`, walking away from the handle.
     * Grouped panels with a preferred size hold it while their elastic
     * group-mates give space (pass 1); only when the whole stack is
     * otherwise exhausted do they shrink below it to their minimum (pass 2).
     */
    const shrinkStack = (
      newShares: number[],
      from: number,
      dir: 1 | -1,
      amount: number
    ) => {
      let remain = amount;
      for (let i = from; i >= 0 && i < n && remain > EPSILON; i += dir) {
        const [minS] = bounds(i);
        const preferred = preferredShare(i);
        const floor =
          preferred === undefined
            ? minS
            : Math.max(minS, Math.min(preferred, newShares[i]));
        const take = Math.min(Math.max(0, newShares[i] - floor), remain);
        newShares[i] -= take;
        remain -= take;
      }
      for (let i = from; i >= 0 && i < n && remain > EPSILON; i += dir) {
        const [minS] = bounds(i);
        const take = Math.min(Math.max(0, newShares[i] - minS), remain);
        newShares[i] -= take;
        remain -= take;
      }
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
      // Move LEFT: shrink LEFT stack, grow RIGHT
      const req = -dShare;
      const capShrinkLeft = shrinkCapLeftStack();
      const capGrowR = growCapFrom(R, 1);
      const applied = Math.min(req, capShrinkLeft, capGrowR);
      if (applied <= 0) return;

      const newShares = shares.slice();
      // shrink from the handle outward: L, L-1, L-2, ...
      shrinkStack(newShares, L, -1, applied);
      growFrom(newShares, R, 1, applied);

      for (let i = 0; i < n; i++) {
        panelData[ids[i]].share = newShares[i];
      }
    } else {
      // dShare > 0: Move RIGHT: shrink RIGHT stack, grow LEFT
      const req = dShare;
      const capShrinkRight = shrinkCapRightStack();
      const capGrowL = growCapFrom(L, -1);
      const applied = Math.min(req, capShrinkRight, capGrowL);
      if (applied <= 0) return;

      const newShares = shares.slice();
      shrinkStack(newShares, R, 1, applied);
      growFrom(newShares, L, -1, applied);

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

    setDirty('manual');
  }

  function swap(firstId: PanelId, secondId: PanelId) {
    if (firstId === secondId) return;

    const ids = untrack(order);
    const firstIndex = ids.indexOf(firstId);
    const secondIndex = ids.indexOf(secondId);
    if (firstIndex < 0 || secondIndex < 0) return;

    const groupBounds = (index: number) => {
      const group = panelData[ids[index]]?.shareGroup;
      if (group === undefined) return [index, index] as const;

      let start = index;
      let end = index;
      while (start > 0 && panelData[ids[start - 1]]?.shareGroup === group) {
        start -= 1;
      }
      while (
        end < ids.length - 1 &&
        panelData[ids[end + 1]]?.shareGroup === group
      ) {
        end += 1;
      }
      return [start, end] as const;
    };

    const [firstStart, firstEnd] = groupBounds(firstIndex);
    const [secondStart, secondEnd] = groupBounds(secondIndex);
    if (firstStart === secondStart) return;

    const [leftStart, leftEnd, rightStart, rightEnd] =
      firstStart < secondStart
        ? [firstStart, firstEnd, secondStart, secondEnd]
        : [secondStart, secondEnd, firstStart, firstEnd];
    const nextIds = [
      ...ids.slice(0, leftStart),
      ...ids.slice(rightStart, rightEnd + 1),
      ...ids.slice(leftEnd + 1, rightStart),
      ...ids.slice(leftStart, leftEnd + 1),
      ...ids.slice(rightEnd + 1),
    ];
    setOrder(nextIds);
  }

  return {
    direction: params.direction,
    addPanel,
    dropPanel,
    updatePanel,
    solve: layout,
    reset: () => {
      const panels = panelsInOrder();
      const units = countUnits(panels);
      if (units === 0) return;
      const groupSizes = new Map<string, number>();
      for (const panel of panels) {
        if (panel.shareGroup !== undefined) {
          groupSizes.set(
            panel.shareGroup,
            (groupSizes.get(panel.shareGroup) ?? 0) + 1
          );
        }
      }
      // Equal share per unit; group members split their unit's share.
      for (const panel of panels) {
        panelData[panel.id].share =
          panel.shareGroup === undefined
            ? 1 / units
            : 1 / units / groupSizes.get(panel.shareGroup)!;
      }
      setDirty();
    },
    order,
    moveHandle,
    swap,
    hasPanel: (id: PanelId) => {
      return order().includes(id) && id in panelData;
    },
    canFitPanel: (panel: Partial<PanelConfig>) => {
      const currentPanels = panelsInOrder();
      const n = currentPanels.length;
      const usable = getUsable(n + 1, params.size(), params.gutter());
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
