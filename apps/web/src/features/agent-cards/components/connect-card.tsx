import { AddCustomMcpDialog } from '@app/features/settings/connections/add-custom-mcp-dialog';
import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { AppConnectionContext } from '@core/pipedream/connection-context';
import { fireAndForget } from '@core/util/fireAndForget';
import Plug from '@icon/system/regular/plug.svg';
import {
  connectMcpServer,
  connectPipedreamApp,
  type PipedreamConnectOutcome,
  useMcpServerConnected,
  usePipedreamConnectedSlugs,
} from '@queries/pipedream-connectors';
import { Badge, Button, Item } from '@ui';
import { ResultAsync } from 'neverthrow';
import {
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import type { ConnectTarget } from '../../dynamic-ui/generated/types';
import { Card, CardSingle } from './kit/card';

/**
 * Something to connect, as a card: its icon and name, then either a Connect
 * button or, once connected, a Connected pill.
 */
export function ConnectCardView(props: {
  name: string;
  kind: string;
  icon: JSX.Element;
  connected: boolean;
  onConnect: () => void;
  /** A sign-in is under way. */
  busy?: boolean;
  /** Connecting is not available here, e.g. to a viewer of the session. */
  disabled?: boolean;
}) {
  return (
    <Card width="column" data-agent-card="connect">
      <CardSingle
        media={<Item.Media class="self-center">{props.icon}</Item.Media>}
        title={props.name}
        description={props.kind}
        trailing={
          <Show
            when={!props.connected}
            fallback={
              <Badge variant="success" size="xs">
                Connected
              </Badge>
            }
          >
            <Button
              size="sm"
              variant="primary"
              aria-label={`Connect ${props.name}`}
              loading={props.busy ?? false}
              disabled={props.disabled}
              onClick={props.onConnect}
            >
              Connect
            </Button>
          </Show>
        }
      />
    </Card>
  );
}

/**
 * An app or MCP server an agent needs connected, with one button that runs
 * its sign-in. In the agent session that presented it, connecting continues
 * the session; elsewhere the reader replies once connected.
 */
export function ConnectCard(props: { name: string; target: ConnectTarget }) {
  return (
    <Switch>
      <Match when={props.target.kind === 'app' && props.target}>
        {(target) => (
          <ConnectAppCard name={props.name} appSlug={target().appSlug} />
        )}
      </Match>
      <Match when={props.target.kind === 'server' && props.target}>
        {(target) => <ConnectServerCard name={props.name} url={target().url} />}
      </Match>
    </Switch>
  );
}

function ConnectAppCard(props: { name: string; appSlug: string }) {
  const session = useContext(AppConnectionContext);
  const connections = usePipedreamConnectedSlugs();
  const [busy, setBusy] = createSignal(false);

  async function connect() {
    setBusy(true);
    if (session) {
      await session.connect({ appSlug: props.appSlug, name: props.name });
      setBusy(false);
      return;
    }
    const outcome = await ResultAsync.fromPromise(
      connectPipedreamApp({ appSlug: props.appSlug, serverName: props.name }),
      () => ({ kind: 'failed' as const })
    );
    setBusy(false);
    if (outcome.isErr()) {
      toast.alert(`Could not connect ${props.name}. Please try again.`);
      return;
    }
    announce(props.name, outcome.value);
  }

  return (
    <ConnectCardView
      name={props.name}
      kind="App"
      icon={<PipedreamConnectorIcon appSlug={props.appSlug} class="size-5" />}
      connected={connections.ready() && connections.slugs().has(props.appSlug)}
      busy={busy()}
      disabled={session?.disabled() ?? false}
      onConnect={() => fireAndForget(connect(), 'connect-card')}
    />
  );
}

function ConnectServerCard(props: { name: string; url: string }) {
  const session = useContext(AppConnectionContext);
  const server = useMcpServerConnected(() => props.url);
  const [busy, setBusy] = createSignal(false);
  const [adding, setAdding] = createSignal(false);

  async function connect() {
    setBusy(true);
    const outcome = await ResultAsync.fromPromise(
      connectMcpServer({ url: props.url, name: props.name }),
      () => ({ kind: 'no-sign-in' as const })
    );
    setBusy(false);
    if (outcome.isErr()) {
      // The sign-in could not start. A server the list confirms the user has
      // not added yet is added by hand, filled in; one they already have, or
      // one the list cannot vouch for yet, gets a message instead.
      if (server.ready() && !server.listed()) {
        setAdding(true);
      } else {
        toast.alert(
          `Could not start a sign-in for ${props.name}. If it needs none, reply to continue.`
        );
      }
      return;
    }
    announce(props.name, outcome.value);
  }

  return (
    <>
      <ConnectCardView
        name={props.name}
        kind="MCP server"
        icon={<Plug class="size-[18px]" />}
        connected={server.ready() && server.connected()}
        busy={busy()}
        disabled={session?.disabled() ?? false}
        onConnect={() => fireAndForget(connect(), 'connect-card')}
      />
      <AddCustomMcpDialog
        open={adding()}
        onOpenChange={setAdding}
        initialName={props.name}
        initialUrl={props.url}
      />
    </>
  );
}

function announce(name: string, outcome: PipedreamConnectOutcome) {
  if (outcome === 'connected') {
    toast.success(`${name} connected. Reply when you are ready to continue.`);
  }
  if (outcome === 'unsupported') {
    toast.alert('Connectors are not available on this deployment');
  }
}
