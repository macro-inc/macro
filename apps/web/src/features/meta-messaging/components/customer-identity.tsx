import { displayAuthorName } from '@core/messages/author-name';
import { Popover } from '@kobalte/core/popover';
import InstagramIcon from '@phosphor/instagram-logo.svg';
import WhatsAppIcon from '@phosphor/whatsapp-logo.svg';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type MessagingProvider, providerName } from '../core/delivery';

/** One provider mark; account and contact details are available on demand. */
export function CustomerIdentity(props: {
  provider: MessagingProvider;
  name: string;
  phone?: string | null;
  handle?: string | null;
  accountName: string;
}) {
  return (
    <Popover placement="bottom-start" gutter={8}>
      <Popover.Trigger
        aria-label={`${providerName(props.provider)} conversation details`}
        title={providerName(props.provider)}
        class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Dynamic
          component={
            props.provider === 'whatsapp' ? WhatsAppIcon : InstagramIcon
          }
          class="size-5"
          aria-hidden="true"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu w-64 rounded-xl border border-edge-muted bg-menu p-4 text-sm text-ink shadow-menu outline-none">
          <Popover.Title class="font-medium">{props.name}</Popover.Title>
          <Show when={props.handle}>
            <p class="mt-1 text-ink-muted">@{props.handle}</p>
          </Show>
          <Show when={props.phone}>
            <p class="mt-1 text-ink-muted">{props.phone}</p>
          </Show>
          <Popover.Description class="mt-3 text-xs text-ink-muted">
            {providerName(props.provider)} messages sent from{' '}
            {displayAuthorName(props.accountName)}.
          </Popover.Description>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
