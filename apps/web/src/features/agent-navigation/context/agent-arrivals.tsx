/**
 * Panes an agent opened that the person hasn't touched yet. An agent opening
 * an item doesn't mean the person read it, so read markers inside such a
 * pane wait until the person interacts with it.
 *
 * The open marks its entry (`meta.openedByAgent`), so the hold is in place
 * from the moment the pane's content mounts, cached content included; the
 * person's first click or key press in the pane releases it.
 */

import type { Entry, PaneId } from '@app/lib/split-router';
import { PaneContext } from '@app/lib/split-router/solid/context';
import {
  type Accessor,
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

/** Entry meta an agent's open sets on the entry it creates. */
export const OPENED_BY_AGENT = { openedByAgent: true } as const;

export type AgentArrivals = {
  /** Whether reads wait in `pane`, which shows `entry`. */
  holds: (pane: PaneId, entry: Entry | undefined) => boolean;
  /** The person touched `pane`: reads there go ahead. */
  release: (pane: PaneId) => void;
};

const AgentArrivalsContext = createContext<AgentArrivals>();

function openedByAgent(entry: Entry | undefined): boolean {
  return entry?.meta?.openedByAgent === true;
}

export function createAgentArrivals(): AgentArrivals {
  const [touched, setTouched] = createSignal<readonly PaneId[]>([]);

  return {
    holds: (pane, entry) => openedByAgent(entry) && !touched().includes(pane),
    release: (pane) =>
      setTouched((current) =>
        current.includes(pane) ? current : [...current, pane]
      ),
  };
}

export function AgentArrivalsProvider(
  props: ParentProps<{ arrivals: AgentArrivals }>
) {
  return (
    <AgentArrivalsContext.Provider value={props.arrivals}>
      {props.children}
    </AgentArrivalsContext.Provider>
  );
}

/**
 * Whether reads in this pane wait: it is an agent's arrival the person
 * hasn't touched. False outside a pane or without the provider.
 */
export function useReadsHeldByAgentArrival(): Accessor<boolean> {
  const pane = useContext(PaneContext);
  const arrivals = useContext(AgentArrivalsContext);

  return () => {
    if (!pane || !arrivals) return false;

    return arrivals.holds(pane.pane(), pane.entry());
  };
}
