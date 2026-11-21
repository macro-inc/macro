import { AddCustomMcpDialog } from '@app/features/settings/connections/add-custom-mcp-dialog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  AppConnectionContext,
  ConnectCardAccessContext,
} from '@core/pipedream/connection-context';
import { fireAndForget } from '@core/util/fireAndForget';
import Plug from '@icon/system/regular/plug.svg';
import {
  connectMcpServer,
  connectPipedreamApp,
  type PipedreamConnectOutcome,
  UnsafeSignInPageError,
  useMcpServerConnected,
  usePipedreamConnectedSlugs,
} from '@queries/pipedream-connectors';
import { Badge, Button, Item } from '@ui';
import { Result, ResultAsync } from 'neverthrow';
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
  /** Why Connect is disabled, read on hover and by assistive tech. */
  disabledReason?: string;
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
                {t('connectCards.connected')}
              </Badge>
            }
          >
            <Button
              size="sm"
              variant="primary"
              aria-label={t('connectCards.connectName', { name: props.name })}
              loading={props.busy ?? false}
              disabled={props.disabled}
              title={props.disabled ? props.disabledReason : undefined}
              onClick={props.onConnect}
            >
              {t('connectCards.connect')}
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

/**
 * Who may press Connect. In the session that presented the card, the session
 * decides (only its owner, while it can continue). Elsewhere, e.g. in a
 * channel, only the session's owner; where no one says, no one.
 */
function useConnectAccess() {
  const session = useContext(AppConnectionContext);
  const access = useContext(ConnectCardAccessContext);
  const outsideAndBlocked = () => !session && !(access?.allowed() ?? false);
  return {
    session,
    disabled: () => session?.disabled() ?? outsideAndBlocked(),
    reason: () =>
      outsideAndBlocked() ? t('connectCards.ownerOnly') : undefined,
  };
}

function ConnectAppCard(props: { name: string; appSlug: string }) {
  const { session, disabled, reason } = useConnectAccess();
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
      toast.alert(t('connectCards.connectFailed', { name: props.name }));
      return;
    }
    announce(props.name, outcome.value);
  }

  return (
    <ConnectCardView
      name={props.name}
      kind={t('connectCards.app')}
      icon={<PipedreamConnectorIcon appSlug={props.appSlug} class="size-5" />}
      connected={connections.ready() && connections.slugs().has(props.appSlug)}
      busy={busy()}
      disabled={disabled()}
      disabledReason={reason()}
      onConnect={() => fireAndForget(connect(), 'connect-card')}
    />
  );
}

/** A server URL's host, as the card names it; undefined if it does not parse. */
function serverHost(url: string): string | undefined {
  return parseUrl(url).match(
    (parsed) => parsed.host,
    () => undefined
  );
}

const parseUrl = Result.fromThrowable(
  (url: string) => new URL(url),
  () => 'unparseable' as const
);

function ConnectServerCard(props: { name: string; url: string }) {
  const { disabled, reason } = useConnectAccess();
  const server = useMcpServerConnected(() => props.url);
  const [busy, setBusy] = createSignal(false);
  const [adding, setAdding] = createSignal(false);

  async function connect() {
    setBusy(true);
    const outcome = await ResultAsync.fromPromise(
      connectMcpServer({ url: props.url, name: props.name }),
      (error) =>
        error instanceof UnsafeSignInPageError
          ? ({ kind: 'unsafe' } as const)
          : ({ kind: 'no-sign-in' } as const)
    );
    setBusy(false);
    if (outcome.isErr()) {
      // The server is in the user's list, so its sign-in could not start;
      // Macro refused its page, or it needs none and works without one.
      toast.alert(
        outcome.error.kind === 'unsafe'
          ? t('connectCards.signInPageInsecure')
          : t('connectCards.signInMayNeedNone', { name: props.name })
      );
      return;
    }
    announce(props.name, outcome.value);
  }

  // A server the user has not added is added by hand first, from a dialog
  // that names its host and URL: the agent chose this URL, so nothing signs
  // in to it until the user has seen where it points.
  function onConnect() {
    if (!server.ready()) {
      toast.alert(t('connectCards.signInTryAgain', { name: props.name }));
    } else if (!server.listed()) {
      setAdding(true);
    } else {
      fireAndForget(connect(), 'connect-card');
    }
  }

  return (
    <>
      <ConnectCardView
        name={props.name}
        kind={t('connectCards.mcpServer', {
          host: serverHost(props.url) ?? t('connectCards.invalidAddress'),
        })}
        icon={<Plug class="size-[18px]" />}
        connected={server.ready() && server.connected()}
        busy={busy()}
        disabled={disabled() || serverHost(props.url) === undefined}
        disabledReason={
          serverHost(props.url) === undefined
            ? t('connectCards.addressInvalid')
            : reason()
        }
        onConnect={onConnect}
      />
      <AddCustomMcpDialog
        open={adding()}
        onOpenChange={setAdding}
        title={(url) =>
          t('connectCards.addHost', {
            host: serverHost(url) ?? t('connectCards.invalidAddress'),
          })
        }
        initialName={props.name}
        initialUrl={props.url}
      />
    </>
  );
}

function announce(name: string, outcome: PipedreamConnectOutcome) {
  if (outcome === 'connected') {
    toast.success(t('connectCards.connectedReply', { name }));
  }
  if (outcome === 'unsupported') {
    toast.alert(t('connectCards.unsupported'));
  }
}
