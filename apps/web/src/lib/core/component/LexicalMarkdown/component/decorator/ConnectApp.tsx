import { HarnessIcon } from '@core/component/HarnessIcon';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { requestConnectApp } from '@core/pipedream/pendingConnect';
import type { ConnectAppDecoratorProps } from '@macro-inc/lexical-core';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import { useHarnessConnectionStatus } from '@queries/harnesses/connections';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import { cn } from '@ui/utils/classname';
import { type Accessor, type JSX, Show, useContext } from 'solid-js';
import { match } from 'ts-pattern';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

/**
 * The chip a reply renders when the reader has to connect something before
 * the agent can continue: a Pipedream app or an agent harness account.
 * Clicking it opens the settings surface
 * that connects it. Once the reader has connected it, the same chip reads as
 * connected rather than nagging.
 */
export function ConnectApp(props: ConnectAppDecoratorProps) {
  return match(props.target)
    .with('connections', () => <ConnectPipedreamApp {...props} />)
    .with('harness', () => <ConnectHarness {...props} />)
    .exhaustive();
}

function ConnectPipedreamApp(props: ConnectAppDecoratorProps) {
  const { openSettings } = useSettingsState();
  const connections = usePipedreamConnectedSlugs();
  return (
    <ConnectChip
      {...props}
      connected={() =>
        connections.ready() && connections.slugs().has(props.appSlug)
      }
      icon={<PipedreamConnectorIcon appSlug={props.appSlug} class="size-3.5" />}
      onConnect={() => {
        // The Integrations tab picks this up and starts the Connect flow.
        requestConnectApp(props.appSlug);
        openSettings('Connected');
      }}
    />
  );
}

function ConnectHarness(props: ConnectAppDecoratorProps) {
  const { openSettings } = useSettingsState();
  const connected = useHarnessConnectionStatus(
    () => props.appSlug,
    useUserId()
  );
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

  return (
    <button
      type="button"
      data-connect-app={props.appSlug}
      data-connect-target={props.target}
      aria-label={
        props.connected() ? `${props.name} connected` : `Connect ${props.name}`
      }
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
      <Show when={props.connected()} fallback={<>Connect {props.name}</>}>
        {props.name} connected
      </Show>
      <Show when={!props.connected()}>
        <ArrowUpRightIcon class="size-3 opacity-70" />
      </Show>
    </button>
  );
}
