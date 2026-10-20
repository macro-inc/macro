import WhatsAppIcon from '@phosphor/whatsapp-logo.svg';
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
    () =>
      !!props.binding &&
      props.binding !== 'native' &&
      props.binding !== 'whatsapp_linked_group'
  );
  const account = () => (queryReadyGate(query) ? query.data : undefined);
  return (
    <Show
      when={props.binding === 'whatsapp_linked_group'}
      fallback={
        <Show when={account()} fallback={props.children}>
          {(value) => <CustomerIdentity account={value()} />}
        </Show>
      }
    >
      <span
        role="img"
        aria-label="WhatsApp group"
        title="WhatsApp group"
        class="flex size-8 shrink-0 items-center justify-center text-ink-muted"
      >
        <WhatsAppIcon class="size-5" aria-hidden="true" />
      </span>
    </Show>
  );
}
