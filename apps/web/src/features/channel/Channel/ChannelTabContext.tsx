import { beginInteraction } from '@app/observability/flow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { ChannelTabId } from './channel-tabs';

type ChannelTabContextValue = {
  activeTab: Accessor<ChannelTabId>;
  setActiveTab: (tab: ChannelTabId) => void;
};

const ChannelTabContext = createContext<ChannelTabContextValue>();

export function ChannelTabProvider(
  props: ParentProps<{
    activeTab: Accessor<ChannelTabId>;
    setActiveTab: (tab: ChannelTabId) => void;
  }>
) {
  const changeTab = (tab: ChannelTabId) => {
    if (tab === props.activeTab()) return;
    const interaction = beginInteraction('channel.tab', {
      attributes: { 'channel.tab': tab },
      closeOnJoin: true,
    });
    try {
      props.setActiveTab(tab);
    } finally {
      // Tab controls commit their selected panel at the end of the event batch.
      queueMicrotask(interaction.end);
    }
  };
  return (
    <ChannelTabContext.Provider
      value={{ activeTab: props.activeTab, setActiveTab: changeTab }}
    >
      {props.children}
    </ChannelTabContext.Provider>
  );
}

export function useChannelTabOptional() {
  return useContext(ChannelTabContext);
}

export function useChannelTab(): ChannelTabContextValue {
  const ctx = useContext(ChannelTabContext);
  if (!ctx) {
    throw new Error('useChannelTab must be used within <ChannelTabProvider>');
  }
  return ctx;
}
