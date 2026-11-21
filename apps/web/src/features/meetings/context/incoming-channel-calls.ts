import { type Accessor, createContext, useContext } from 'solid-js';
import type { IncomingChannelCall } from '../core/incoming-channel-calls';

type IncomingChannelCalls = {
  calls: Accessor<IncomingChannelCall[]>;
  join: (call: IncomingChannelCall) => void;
  decline: (call: IncomingChannelCall) => void;
};

export const IncomingChannelCallsContext =
  createContext<IncomingChannelCalls>();

export function useIncomingChannelCalls() {
  const context = useContext(IncomingChannelCallsContext);
  if (!context)
    throw new Error('Incoming channel calls require their provider');
  return context;
}
