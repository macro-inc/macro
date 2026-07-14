import { type Accessor, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

/** Region render order in the host, top to bottom. Add new regions here. */
export const FLOAT_REGIONS = ['accessory', 'dock'] as const;

export type FloatRegionName = (typeof FLOAT_REGIONS)[number];

type FloatRegionRegistration = {
  /** Unique identity; comparisons use this rather than object reference. */
  id: symbol;
  /** Higher wins; ties go to the most recently mounted contributor. */
  priority: number;
  /** Reactive gate: panel activity, keyboard visibility, etc. */
  isActive: Accessor<boolean>;
  /** Mount order, used to break priority ties. */
  seq: number;
};

export type FloatRegionRegistrationHandle = {
  /** Reactive: whether this contribution currently wins its region. */
  isWinner: () => boolean;
  unregister: () => void;
};

function createFloatRegionsState() {
  // Regions are independent silos — keyed by region so winner recomputation
  // in one region never tracks changes in another.
  const [registrations, setRegistrations] = createStore(
    Object.fromEntries(
      FLOAT_REGIONS.map((region) => [region, [] as FloatRegionRegistration[]])
    ) as Record<FloatRegionName, FloatRegionRegistration[]>
  );
  const [mounts, setMounts] = createStore<
    Partial<Record<FloatRegionName, HTMLElement>>
  >({});
  const [hostHeight, setHostHeight] = createSignal(0);
  let nextSeq = 0;

  function register(
    input: Omit<FloatRegionRegistration, 'id' | 'seq'> & {
      region: FloatRegionName;
    }
  ): FloatRegionRegistrationHandle {
    const { region, ...rest } = input;
    const entry: FloatRegionRegistration = {
      ...rest,
      id: Symbol('float-region-registration'),
      seq: nextSeq++,
    };
    setRegistrations(region, (prev) => [...prev, entry]);
    return {
      isWinner: () => winnerOf(region)?.id === entry.id,
      unregister: () =>
        setRegistrations(region, (prev) =>
          prev.filter((r) => r.id !== entry.id)
        ),
    };
  }

  function winnerOf(
    region: FloatRegionName
  ): FloatRegionRegistration | undefined {
    let winner: FloatRegionRegistration | undefined;
    for (const r of registrations[region]) {
      if (!r.isActive()) continue;
      if (
        !winner ||
        r.priority > winner.priority ||
        (r.priority === winner.priority && r.seq > winner.seq)
      ) {
        winner = r;
      }
    }
    return winner;
  }

  return {
    register,
    setMount: (region: FloatRegionName, el: HTMLElement) =>
      setMounts(region, el),
    mount: (region: FloatRegionName) => mounts[region],
    /** Measured height of the visible bottom-chrome stack, in px.
     *  Same value as the `--mobile-content-inset-bottom` CSS variable. */
    hostHeight,
    setHostHeight,
  };
}

/** Global mobile bottom-chrome registry — one host per app (see FloatRegionHost). */
export const FloatRegions = createFloatRegionsState();
