import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { HarnessIcon } from '@core/component/HarnessIcon';
import { ConnectorIcon } from '@core/connectors/ConnectorIcon';
import { AppConnectionContext } from '@core/connectors/connection-context';
import { requestConnectApp } from '@core/connectors/pendingConnect';
import { useSettingsState } from '@core/constant/SettingsState';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import type { ConnectAppDecoratorProps } from '@macro-inc/lexical-core';
import { useConnectors } from '@queries/connectors';
import { useHarnessConnectionStatus } from '@queries/harnesses/connections';
import { cn } from '@ui/utils/classname';
import { type Accessor, type JSX, Show, useContext } from 'solid-js';
import { match } from 'ts-pattern';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

/**
 * The chip a reply renders when the reader has to connect something before
 * the agent can continue: a catalog app or an agent harness account.
 * Clicking it opens the settings surface
 * that connects it. Once the reader has connected it, the same chip reads as
 * connected rather than nagging.
 */
export function ConnectApp(props: ConnectAppDecoratorProps) {
  return match(props.target)
    .with('connections', () => <ConnectCatalogApp {...props} />)
    .with('harness', () => <ConnectHarness {...props} />)
    .exhaustive();
}

function ConnectCatalogApp(props: ConnectAppDecoratorProps) {
  const inChat = useContext(AppConnectionContext);
  const layout = useSplitLayout();
  const connectors = useConnectors();
  return (
    <ConnectChip
      {...props}
      connected={() =>
        connectors.ready() && connectors.connectedApps().has(props.appSlug)
      }
      icon={<ConnectorIcon appSlug={props.appSlug} class="size-3.5" />}
      disabled={inChat?.disabled}
      onConnect={() => {
        if (inChat) {
          fireAndForget(
            inChat.connect({ appSlug: props.appSlug, name: props.name }),
            'connect-app'
          );
          return;
        }
        // Integrations picks this up and starts connecting the app.
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

  return (
    <button
      type="button"
      disabled={props.disabled?.()}
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
