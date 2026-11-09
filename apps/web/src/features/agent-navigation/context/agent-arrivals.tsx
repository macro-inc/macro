/**
 * Panes an agent opened that the person hasn't touched yet. An agent opening
 * an item doesn't mean the person read it, so read markers inside such a
 * pane wait until the person interacts with it.
 */

import type { PaneId } from '@app/lib/split-router';
import { PaneContext } from '@app/lib/split-router/solid/context';
import {
  type Accessor,
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

export type AgentArrivals = {
  /** The pane is an agent's arrival the person hasn't touched. */
  holds: (pane: PaneId) => boolean;
  add: (pane: PaneId) => void;
  release: (pane: PaneId) => void;
};

const AgentArrivalsContext = createContext<AgentArrivals>();

export function createAgentArrivals(): AgentArrivals {
  const [panes, setPanes] = createSignal<readonly PaneId[]>([]);

  return {
    holds: (pane) => panes().includes(pane),
    add: (pane) =>
      setPanes((current) =>
        current.includes(pane) ? current : [...current, pane]
      ),
    release: (pane) =>
      setPanes((current) =>
        current.includes(pane)
          ? current.filter((held) => held !== pane)
          : current
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

    return arrivals.holds(pane.pane());
  };
}
