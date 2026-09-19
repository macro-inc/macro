import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { Tab } from 'tab-election';

/**
 * Long-lived cross-tab leader election, backed by `tab-election` (Web Locks
 * API + BroadcastChannel). At most one tab per `namespace` is leader at a
 * time, and leadership fails over automatically when the leader tab closes
 * or crashes.
 *
 * Leadership is first-come-first-served with no way to rank candidates or
 * displace a live leader, and it requires the Locks API. An election that
 * needs either property — e.g. preferring audibly-capable tabs, or working
 * in embedded browsers without locks — builds its own protocol on
 * `cross-tab-bus.ts` instead (see `features/channel/Call/ring-coordination.ts`).
 */
export const createTabLeaderSignal = (namespace: string): Accessor<boolean> => {
  const [isLeader, setIsLeader] = createSignal<boolean>(false);
  const tab = new Tab(namespace);

  tab.waitForLeadership(() => {
    setIsLeader(true);

    return () => {
      setIsLeader(false);
    };
  });

  onCleanup(() => {
    tab.close();
  });

  return isLeader;
};
