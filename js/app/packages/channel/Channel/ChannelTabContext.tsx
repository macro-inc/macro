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
  return (
    <ChannelTabContext.Provider
      value={{ activeTab: props.activeTab, setActiveTab: props.setActiveTab }}
    >
      {props.children}
    </ChannelTabContext.Provider>
  );
}

export function useChannelTab(): ChannelTabContextValue {
  const ctx = useContext(ChannelTabContext);
  if (!ctx) {
    throw new Error('useChannelTab must be used within <ChannelTabProvider>');
  }
  return ctx;
}
