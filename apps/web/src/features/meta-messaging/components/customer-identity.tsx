import { Popover } from '@kobalte/core/popover';
import InstagramIcon from '@phosphor/instagram-logo.svg';
import WhatsAppIcon from '@phosphor/whatsapp-logo.svg';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ConversationAccount } from '../core/conversation';
import { providerName } from '../core/delivery';

/** One provider mark; account and contact details are available on demand. */
export function CustomerIdentity(props: {
  account: Pick<
    ConversationAccount,
    'provider' | 'account_name' | 'conversation'
  >;
}) {
  const customer = () => props.account.conversation;
  return (
    <Popover placement="bottom-start" gutter={8}>
      <Popover.Trigger
        aria-label={`${providerName(props.account.provider)} conversation details`}
        title={providerName(props.account.provider)}
        class="flex size-8 touch:size-11 shrink-0 items-center justify-center rounded-full text-ink-muted not-touch:hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Dynamic
          component={
            props.account.provider === 'whatsapp' ? WhatsAppIcon : InstagramIcon
          }
          class="size-5"
          aria-hidden="true"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu w-64 rounded-xl border border-edge-muted bg-menu p-4 text-sm text-ink shadow-menu outline-none">
          <Popover.Title class="font-medium">
            {customer().customer_display_name ??
              customer().customer_handle ??
              customer().customer_phone ??
              customer().customer_id}
          </Popover.Title>
          <Show when={customer().customer_handle}>
            <p class="mt-1 text-ink-muted">@{customer().customer_handle}</p>
          </Show>
          <Show when={customer().customer_phone}>
            <p class="mt-1 text-ink-muted">{customer().customer_phone}</p>
          </Show>
          <Popover.Description class="mt-3 text-xs text-ink-muted">
            {providerName(props.account.provider)} messages sent from{' '}
            {props.account.account_name.trim()}.
          </Popover.Description>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
