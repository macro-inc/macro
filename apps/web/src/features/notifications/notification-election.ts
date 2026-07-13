import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { Tab } from 'tab-election';

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
