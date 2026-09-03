import { IncomingCallEvents } from '@block-call/sidebar/incoming-calls';
import { CallProvider } from '@channel/Call/CallContext';
import { CallStartedNotifier } from '@channel/Call/CallStartedNotifier';
import { CallKitSync } from '@channel/Call/use-callkit';
import type { ParentProps } from 'solid-js';

export function AuthenticatedCallProviders(props: ParentProps) {
  return (
    <CallProvider>
      <CallKitSync />
      <CallStartedNotifier />
      <IncomingCallEvents />
      {props.children}
    </CallProvider>
  );
}
