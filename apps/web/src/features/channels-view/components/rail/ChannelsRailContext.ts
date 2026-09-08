import { createAssertedContextProvider } from '@core/context/createContext';
import type { ContextProviderProps } from '@solid-primitives/context';
import type { ChannelsRailController } from './useChannelsRailController';

type ChannelsRailProviderProps = ContextProviderProps & {
  value: ChannelsRailController;
};

export const [ChannelsRailProvider, useChannelsRail] =
  createAssertedContextProvider<
    ChannelsRailController,
    ChannelsRailProviderProps
  >('ChannelsRail', (props) => props.value);
