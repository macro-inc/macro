import { useSettingsState } from '@core/constant/SettingsState';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { requestConnectApp } from '@core/pipedream/pendingConnect';
import type { ConnectAppDecoratorProps } from '@macro-inc/lexical-core';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import { cn } from '@ui';
import { Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

/**
 * The chip an agent's reply renders when a tool call failed because the
 * reader has not connected an app. Clicking it opens Settings → Connections
 * with that app queued to connect. Once the reader has connected it, the same
 * chip reads as connected rather than nagging.
 */
export function ConnectApp(props: ConnectAppDecoratorProps) {
  const { openSettings } = useSettingsState();
  const connections = usePipedreamConnectedSlugs();
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;
  const connected = () =>
    connections.ready() && connections.slugs().has(props.appSlug);

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const handleClick = () => {
    if (connected()) return;
    // The Connections page picks this up and starts the Connect flow.
    requestConnectApp(props.appSlug);
    openSettings('Connected');
  };

  return (
    <button
      type="button"
      data-connect-app={props.appSlug}
      aria-label={
        connected() ? `${props.name} connected` : `Connect ${props.name}`
      }
      class={cn(
        'pointer-events-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle text-xs font-medium',
        'cursor-default outline-none transition-colors',
        connected()
          ? 'border-edge-muted text-ink-muted'
          : 'border-accent/40 text-accent hover:bg-accent/10 focus-visible:bg-accent/10',
        isSelectedAsNode() && 'bg-active'
      )}
      // Keep the editor's selection where it was: this is an action, not a
      // caret target.
      onMouseDown={(event) => event.preventDefault()}
      onClick={handleClick}
    >
      <PipedreamConnectorIcon appSlug={props.appSlug} class="size-3.5" />
      <Show when={connected()} fallback={<>Connect {props.name}</>}>
        {props.name} connected
      </Show>
      <Show when={!connected()}>
        <ArrowUpRightIcon class="size-3 opacity-70" />
      </Show>
    </button>
  );
}
