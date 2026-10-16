import { queryReadyGate } from '@queries/gate';
import { useMetaConversation } from '@queries/meta-messaging';
import { type JSX, Show } from 'solid-js';
import { CustomerIdentity } from '../components/customer-identity';
import { mayHaveExternalBinding } from '../core/conversation';

export function ChannelMessagingIdentity(props: {
  channelId: string;
  channelType: string | undefined;
  children: JSX.Element;
}) {
  const query = useMetaConversation(
    () => props.channelId,
    () => mayHaveExternalBinding(props.channelType)
  );
  const account = () => (queryReadyGate(query) ? query.data : undefined);
  return (
    <Show when={account()} fallback={props.children}>
      {(value) => (
        <CustomerIdentity
          provider={value().provider}
          name={
            value().conversation.customer_display_name ??
            value().conversation.customer_handle ??
            value().conversation.customer_phone ??
            value().conversation.customer_id
          }
          phone={value().conversation.customer_phone}
          handle={value().conversation.customer_handle}
          accountName={value().account_name}
        />
      )}
    </Show>
  );
}
