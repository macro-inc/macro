import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { ConnectAction } from '../integration-ui';
import {
  type ConnectionMenuItem,
  ConnectionRowActions,
} from './connection-more';
import type { CapabilityStatus } from './model';

export function AiGrantActions(props: {
  status: CapabilityStatus;
  onConnect: () => void;
  onReconnect: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDisconnect: () => void;
  connectBusy?: boolean;
  authPending?: boolean;
  updatePending?: boolean;
  removePending?: boolean;
}): JSX.Element {
  const reconnectItem = (): ConnectionMenuItem => ({
    label: 'Reconnect',
    onSelect: props.onReconnect,
    disabled: props.authPending || props.connectBusy,
    icon: 'reconnect',
  });
  const disconnectItem = (): ConnectionMenuItem => ({
    label: 'Disconnect',
    danger: true,
    onSelect: props.onDisconnect,
    disabled: props.removePending,
    icon: 'disconnect',
  });

  return match(props.status)
    .with('not-connected', () => (
      <ConnectionRowActions
        primary={
          <ConnectAction
            label="Connect"
            onClick={props.onConnect}
            loading={props.connectBusy}
          />
        }
        items={[]}
      />
    ))
    .with('action-required', () => (
      <ConnectionRowActions
        primary={
          <ConnectAction
            label="Reconnect"
            onClick={props.onReconnect}
            disabled={props.authPending || props.connectBusy}
          />
        }
        items={[reconnectItem(), disconnectItem()]}
      />
    ))
    .with('connected', () => (
      <ConnectionRowActions
        items={[
          {
            label: 'Disable',
            onSelect: props.onDisable,
            disabled: props.updatePending,
            icon: 'disable',
          },
          reconnectItem(),
          disconnectItem(),
        ]}
      />
    ))
    .with('off', () => (
      <ConnectionRowActions
        primary={
          <ConnectAction
            label="Enable"
            variant="neutral"
            onClick={props.onEnable}
            disabled={props.updatePending}
          />
        }
        items={[reconnectItem(), disconnectItem()]}
      />
    ))
    .exhaustive();
}
