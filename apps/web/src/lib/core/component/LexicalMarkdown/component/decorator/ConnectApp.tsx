import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { HarnessIcon } from '@core/component/HarnessIcon';
import { useSettingsState } from '@core/constant/SettingsState';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { AppConnectionContext } from '@core/pipedream/connection-context';
import { requestConnectApp } from '@core/pipedream/pendingConnect';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import type { ConnectAppDecoratorProps } from '@macro-inc/lexical-core';
import { useHarnessConnectionStatus } from '@queries/harnesses/connections';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createSignal,
  type JSX,
  Show,
  useContext,
} from 'solid-js';
import { match } from 'ts-pattern';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

/**
 * The chip a reply renders when the reader has to connect something before
 * the agent can continue: a Pipedream app or an agent harness account.
 * Clicking it opens the settings surface
 * that connects it. Once the reader has connected it, the same chip reads as
 * connected rather than nagging.
 *
 * A `reconnect` chip is for an app whose connection exists but expired, so
 * the app already counts as connected: it stays clickable until the reader
 * reconnects from it. "Reconnected" is this chip's own state, set by an
 * in-chat connect; a remount, or a reconnect made in Connections, reads
 * "Reconnect" again.
 */
export function ConnectApp(props: ConnectAppDecoratorProps) {
  return match(props.target)
    .with('connections', () => <ConnectPipedreamApp {...props} />)
    .with('harness', () => <ConnectHarness {...props} />)
    .exhaustive();
}

function ConnectPipedreamApp(props: ConnectAppDecoratorProps) {
  const inChat = useContext(AppConnectionContext);
  const layout = useSplitLayout();
  const connections = usePipedreamConnectedSlugs();
  // An expired connection still has its row, so the connected slugs can't
  // tell it was renewed; only this chip's own connect can.
  const [reconnected, setReconnected] = createSignal(false);
  const connected = () => {
    if (props.reconnect) return reconnected();
    return connections.ready() && connections.slugs().has(props.appSlug);
  };
  const connectInChat = async (
    connect: NonNullable<typeof inChat>['connect']
  ) => {
    const done = await connect({ appSlug: props.appSlug, name: props.name });
    if (done) setReconnected(true);
  };
  return (
    <ConnectChip
      {...props}
      connected={connected}
      icon={<PipedreamConnectorIcon appSlug={props.appSlug} class="size-3.5" />}
      disabled={inChat?.disabled}
      onConnect={() => {
        if (inChat) {
          fireAndForget(connectInChat(inChat.connect), 'connect-app');
          return;
        }
        // Connections picks this up and starts the Connect flow.
        requestConnectApp(props.appSlug);
        openAgentsPage(layout, 'connections');
      }}
    />
  );
}

function ConnectHarness(props: ConnectAppDecoratorProps) {
  const { openSettings } = useSettingsState();
  const connected = useHarnessConnectionStatus(() => props.appSlug);
  return (
    <ConnectChip
      {...props}
      connected={connected}
      icon={<HarnessIcon harness={props.appSlug} class="size-3.5" />}
      onConnect={() => openSettings('Harness')}
    />
  );
}

function ConnectChip(
  props: ConnectAppDecoratorProps & {
    connected: Accessor<boolean>;
    icon: JSX.Element;
    onConnect: () => void;
    disabled?: Accessor<boolean>;
  }
) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const handleClick = () => {
    if (props.connected()) return;
    props.onConnect();
  };

  const label = () => {
    if (props.connected()) {
      return props.reconnect
        ? `${props.name} reconnected`
        : `${props.name} connected`;
    }
    return props.reconnect
      ? `Reconnect ${props.name}`
      : `Connect ${props.name}`;
  };

  return (
    <button
      type="button"
      disabled={props.disabled?.()}
      data-connect-app={props.appSlug}
      data-connect-target={props.target}
      aria-label={label()}
      class={cn(
        'pointer-events-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle text-xs font-medium',
        'cursor-default outline-none transition-colors',
        props.connected()
          ? 'border-edge-muted text-ink-muted'
          : 'border-accent/40 text-accent hover:bg-accent/10 focus-visible:bg-accent/10',
        isSelectedAsNode() && 'bg-active'
      )}
      // Keep the editor's selection where it was: this is an action, not a
      // caret target.
      onMouseDown={(event) => event.preventDefault()}
      onClick={handleClick}
    >
      {props.icon}
      {label()}
      <Show when={!props.connected()}>
        <ArrowUpRightIcon class="size-3 opacity-70" />
      </Show>
    </button>
  );
}
