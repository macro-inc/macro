import { queryReadyGate } from '@queries/gate';
import { useMetaConversation } from '@queries/meta-messaging';
import { type JSX, Show } from 'solid-js';
import { CustomerIdentity } from '../components/customer-identity';

export function ChannelMessagingIdentity(props: {
  channelId: string;
  binding: string | undefined;
  children: JSX.Element;
}) {
  const query = useMetaConversation(
    () => props.channelId,
    () => !!props.binding && props.binding !== 'native'
  );
  const account = () => (queryReadyGate(query) ? query.data : undefined);
  return (
    <Show when={account()} fallback={props.children}>
      {(value) => <CustomerIdentity account={value()} />}
    </Show>
  );
}
