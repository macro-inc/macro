import DotsThreeIcon from '@phosphor/dots-three.svg';
import LinkBreakIcon from '@phosphor/link-break.svg';
import WhatsappIcon from '@phosphor/whatsapp-logo.svg';
import { Button, Dropdown, Item } from '@ui';
import type { WhatsAppAccount } from '../core/account';
import { WhatsAppTile } from './whatsapp-tile';

/** Nothing linked yet: what linking means, its risk, and Connect. */
export function ConnectCard(props: {
  reconnect: boolean;
  /** Pairing is switched off on the server. */
  unavailable: boolean;
  pending: boolean;
  onConnect: () => void;
}) {
  return (
    <Item variant="outlined">
      <WhatsAppTile />
      <Item.Content>
        <Item.Title>WhatsApp</Item.Title>
        <Item.Description>
          {props.reconnect
            ? 'WhatsApp signed this device out. Link it again to keep your groups syncing.'
            : 'Link your personal WhatsApp as a linked device. Only groups you choose come into Macro.'}
        </Item.Description>
        <Item.Metadata>
          Macro connects as an unofficial WhatsApp client, which WhatsApp may
          restrict or ban accounts for.
        </Item.Metadata>
      </Item.Content>
      <Item.Actions class="self-center">
        <Button
          type="button"
          variant="strong"
          disabled={props.unavailable || props.pending}
          tooltip={
            props.unavailable ? 'Linking WhatsApp is turned off' : undefined
          }
          onClick={props.onConnect}
        >
          {props.reconnect ? 'Reconnect' : 'Connect'}
        </Button>
      </Item.Actions>
    </Item>
  );
}

/**
 * The linked account as a slim strip above the chat list: number, state, and
 * a menu to disconnect it. One account at a time: to switch, disconnect and
 * connect again.
 */
export function AccountStrip(props: {
  account: WhatsAppAccount;
  pending: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div class="flex min-w-0 shrink-0 items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        class="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#25D366] text-[#fff]"
      >
        <WhatsappIcon class="size-3.5" />
      </span>
      <span class="ph-no-capture truncate font-medium text-ink">
        {props.account.phone ?? 'Your WhatsApp'}
      </span>
      <span class="shrink-0 text-ink-extra-muted">Connected</span>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          class="text-ink-muted hover:text-ink"
          aria-label="WhatsApp account options"
          disabled={props.pending}
        >
          <DotsThreeIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-52">
          <Dropdown.Group>
            <Dropdown.Item
              class="text-failure data-highlighted:bg-failure-bg"
              onSelect={props.onDisconnect}
            >
              <LinkBreakIcon class="size-4" />
              Disconnect
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
