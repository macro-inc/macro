import { Button, Item } from '@ui';
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

/** The linked account and its Disconnect action. */
export function AccountCard(props: {
  account: WhatsAppAccount;
  pending: boolean;
  onDisconnect: () => void;
  onReplace: () => void;
}) {
  return (
    <Item variant="outlined">
      <WhatsAppTile />
      <Item.Content>
        <Item.Title>{props.account.phone ?? 'Your WhatsApp'}</Item.Title>
        <Item.Description>Connected · linked device</Item.Description>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="-ml-2"
            disabled={props.pending}
            onClick={props.onReplace}
          >
            Use a different account
          </Button>
        </div>
      </Item.Content>
      <Item.Actions class="self-center">
        <Button
          type="button"
          variant="danger"
          disabled={props.pending}
          onClick={props.onDisconnect}
        >
          Disconnect
        </Button>
      </Item.Actions>
    </Item>
  );
}
