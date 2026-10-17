import {
  Card,
  CardFooter,
  CardHeader,
  CardSingle,
} from '@app/features/agent-cards/components/kit/card';
import {
  CardBadge,
  Tile,
} from '@app/features/agent-cards/components/kit/parts';
import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useOptionalMessage } from '@app/features/channel/Message/context';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { HarnessIcon } from '@core/component/HarnessIcon';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { AppConnectionContext } from '@core/pipedream/connection-context';
import { requestConnectApp } from '@core/pipedream/pendingConnect';
import { getDisplayName, tryMacroId } from '@core/user';
import type { ConnectAppDecoratorProps } from '@macro-inc/lexical-core';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { useHarnessConnectionStatus } from '@queries/harnesses/connections';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import {
  $getNodeByKey,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type LexicalNode,
} from 'lexical';
import {
  type Accessor,
  type JSX,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { match } from 'ts-pattern';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

/**
 * Where a connect button stands for its reader: not connected yet, signing
 * in, failed, connected - and then the agent carrying on, when it was
 * connected here - or waiting on someone else, the person the agent works
 * for, whose account it needs.
 */
export type ConnectState =
  | 'idle'
  | 'connecting'
  | 'failed'
  | 'connected'
  | 'resumed'
  | 'waiting';

type ConnectProps = ConnectAppDecoratorProps & {
  /**
   * The button is alone on its line: the reply is waiting on it. A static
   * render knows from the node; inside an editor the button reads it there.
   */
  standalone?: boolean;
};

/**
 * The button a reply renders when the reader has to connect something
 * before the agent can continue: a Pipedream app or an agent harness
 * account. On a line of its own - the agent blocked on it - it is a card
 * that asks, the way a question does; inside a sentence it is a chip that
 * names the app. Clicking it connects in place where the surface can (an
 * agent session, a DM with an agent), and otherwise opens the settings
 * surface that connects it. Once the reader has connected it, it says so
 * instead of asking again.
 */
export function ConnectApp(props: ConnectProps) {
  return match(props.target)
    .with('connections', () => <ConnectPipedreamApp {...props} />)
    .with('harness', () => <ConnectHarness {...props} />)
    .exhaustive();
}

/** Whether `node` is alone on its line, apart from blank text and breaks. */
export function $isAloneOnItsLine(node: LexicalNode | null): boolean {
  const parent = node?.getParent();
  if (!node || !parent || !$isParagraphNode(parent)) return false;
  return parent
    .getChildren()
    .every(
      (child) =>
        child.is(node) ||
        $isLineBreakNode(child) ||
        ($isTextNode(child) && !child.getTextContent().trim())
    );
}

/** The agent whose reply holds the button, by name, inside a message. */
function useAgentName(): Accessor<string | undefined> {
  const message = useOptionalMessage();
  return () => {
    const current = message?.();
    return current
      ? getBotDisplayName(current.sender_id, current.sender)
      : undefined;
  };
}

/**
 * Who has to connect it, when that is not the reader: an agent uses the
 * connections of the person it works for, so anyone else connecting their
 * own account would not unblock it.
 */
function useWaitingOn(): Accessor<string | undefined> {
  const message = useOptionalMessage();
  const userId = useUserId();
  return () => {
    const asker = message?.().sender?.triggered_by;
    const reader = userId();
    if (!asker || !reader || asker === reader) return undefined;
    return getDisplayName(tryMacroId(asker)) || 'the person who asked';
  };
}

function ConnectPipedreamApp(props: ConnectProps) {
  const context = useContext(AppConnectionContext);
  const inChat = () => (context?.enabled?.() === false ? undefined : context);
  // The reply the button sits in, so the surface can tell whether the agent
  // is still waiting on this reply when the app is connected.
  const message = useOptionalMessage();
  const layout = useSplitLayout();
  const connections = usePipedreamConnectedSlugs();
  const waitingOn = useWaitingOn();
  const state = (): ConnectState => {
    if (waitingOn()) return 'waiting';
    const here = inChat();
    if (connections.ready() && connections.slugs().has(props.appSlug)) {
      return here?.resumed?.().has(props.appSlug) ? 'resumed' : 'connected';
    }
    if (here?.connecting?.() === props.appSlug) return 'connecting';
    if (here?.failed?.() === props.appSlug) return 'failed';
    return 'idle';
  };
  return (
    <ConnectButton
      {...props}
      state={state()}
      inPlace={!!inChat()}
      waitingOn={waitingOn()}
      icon={(size) => (
        <PipedreamConnectorIcon appSlug={props.appSlug} class={size} />
      )}
      disabled={inChat()?.disabled() ?? false}
      onConnect={() => {
        const inPlace = inChat();
        if (inPlace) {
          const reply = message?.();
          void inPlace.connect(
            { appSlug: props.appSlug, name: props.name },
            reply && { messageId: reply.id, postedAt: reply.created_at }
          );
          return;
        }
        // Connections picks this up and starts the Connect flow.
        requestConnectApp(props.appSlug);
        openAgentsPage(layout, 'connections');
      }}
    />
  );
}

function ConnectHarness(props: ConnectProps) {
  const { openSettings } = useSettingsState();
  const connected = useHarnessConnectionStatus(
    () => props.appSlug,
    useUserId()
  );
  return (
    <ConnectButton
      {...props}
      state={connected() ? 'connected' : 'idle'}
      inPlace={false}
      icon={(size) => <HarnessIcon harness={props.appSlug} class={size} />}
      onConnect={() => openSettings('Harness')}
    />
  );
}

type ConnectButtonProps = ConnectProps & {
  state: ConnectState;
  /** Connecting happens here; otherwise the button opens settings. */
  inPlace: boolean;
  waitingOn?: string;
  /** The app's icon at a size class: small in a chip, larger on a card. */
  icon: (size: string) => JSX.Element;
  onConnect: () => void;
  disabled?: boolean;
};

function ConnectButton(props: ConnectButtonProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const agent = useAgentName();
  // On a line of its own, the button is what the reply is waiting on.
  const alone =
    props.standalone ??
    (() => {
      const editor = lexicalWrapper?.editor;
      if (!editor) return false;
      return editor
        .getEditorState()
        .read(() => $isAloneOnItsLine($getNodeByKey(props.key)));
    })();
  if (alone) {
    return (
      <ConnectCardView
        appSlug={props.appSlug}
        name={props.name}
        icon={props.icon}
        state={props.state}
        inPlace={props.inPlace}
        agent={agent()}
        waitingOn={props.waitingOn}
        disabled={props.disabled}
        onConnect={props.onConnect}
      />
    );
  }

  const isSelectedAsNode = () => {
    const selection = lexicalWrapper?.selection;
    return selection?.type === 'node' && selection.nodeKeys.has(props.key);
  };
  return (
    <ConnectChipView
      appSlug={props.appSlug}
      target={props.target}
      name={props.name}
      icon={props.icon}
      state={props.state}
      inPlace={props.inPlace}
      disabled={props.disabled}
      selected={isSelectedAsNode()}
      onConnect={props.onConnect}
    />
  );
}

const connected = (state: ConnectState) =>
  state === 'connected' || state === 'resumed';

/**
 * A connect button on a line of its own: the agent is waiting on the
 * reader, so it asks the way a question does - the app, who needs it, and
 * one action. While the app's sign-in is open the action says so; a failed
 * attempt says so and offers it again. Once connected it shrinks to a
 * receipt that says the agent can use it, or is already carrying on.
 * Someone the agent does not work for sees who it is waiting on instead.
 */
export function ConnectCardView(props: {
  appSlug: string;
  name: string;
  icon: (size: string) => JSX.Element;
  state: ConnectState;
  inPlace: boolean;
  /** The agent waiting on it, by name. */
  agent?: string;
  /** Who has to connect it, when not the reader. */
  waitingOn?: string;
  disabled?: boolean;
  onConnect: () => void;
}) {
  const agent = () => props.agent ?? 'The agent';
  const note = () =>
    match(props.state)
      .with('connecting', () => `Finish signing in to ${props.name}`)
      .with('failed', () => `Couldn't connect ${props.name}`)
      .otherwise(() =>
        props.inPlace
          ? `${agent()} carries on once it's connected`
          : 'Opens your connections'
      );
  return (
    <span
      class="my-1 flex w-full"
      data-connect-app={props.appSlug}
      data-connect-state={props.state}
    >
      <Show
        when={!connected(props.state)}
        fallback={
          <Card width="compact" data-agent-card="connect">
            <CardSingle
              tile={
                <Tile tone="frame" class="text-ink">
                  {props.icon('size-5')}
                </Tile>
              }
              title={props.name}
              badge={<CardBadge tone="ok">Connected</CardBadge>}
              meta={
                props.state === 'resumed'
                  ? `${agent()} is carrying on`
                  : `${agent()} can use it now`
              }
            />
          </Card>
        }
      >
        <Card width="standard" data-agent-card="connect">
          <section
            aria-label={`Connect ${props.name}`}
            class="flex min-h-0 flex-col"
          >
            <CardHeader
              center
              padded={props.state === 'waiting'}
              tile={
                <Tile
                  size={40}
                  tone="frame"
                  // The app's own mark, at full contrast: the app is the
                  // subject, and its glyph takes the text color.
                  class={cn(
                    'text-ink',
                    props.state === 'connecting' && 'animate-pulse'
                  )}
                >
                  {props.icon('size-6')}
                </Tile>
              }
              title={`Connect ${props.name}`}
              subtitle={
                props.state === 'waiting'
                  ? `Waiting on ${props.waitingOn} to connect it`
                  : props.agent
                    ? `${props.agent} needs it to continue`
                    : 'Needed to continue'
              }
            />
            <Show when={props.state !== 'waiting'}>
              <CardFooter>
                <span
                  class={cn(
                    'mr-auto min-w-0 truncate text-xs',
                    props.state === 'failed'
                      ? 'text-failure-ink'
                      : 'text-ink-subtle'
                  )}
                  role={props.state === 'failed' ? 'alert' : undefined}
                >
                  {note()}
                </span>
                <Button
                  size="sm"
                  variant="cta"
                  disabled={props.disabled || props.state === 'connecting'}
                  onMouseDown={(event: MouseEvent) => event.preventDefault()}
                  onClick={() => props.onConnect()}
                >
                  <Switch>
                    <Match when={props.state === 'connecting'}>
                      <SpinnerIcon
                        class="size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      Connecting…
                    </Match>
                    <Match when={props.state === 'failed'}>Try again</Match>
                    <Match when={true}>
                      Connect
                      <Show when={!props.inPlace}>
                        <ArrowUpRightIcon class="size-3.5" aria-hidden="true" />
                      </Show>
                    </Match>
                  </Switch>
                </Button>
              </CardFooter>
            </Show>
          </section>
        </Card>
      </Show>
    </span>
  );
}

/**
 * A connect button inside a sentence: the app, named the way a mention
 * names an item, with what to do about it. Connected, it reads as the app
 * with a check, and clicking it does nothing. An arrow means it leaves for
 * settings rather than connecting in place.
 */
export function ConnectChipView(props: {
  appSlug: string;
  target?: string;
  name: string;
  icon: (size: string) => JSX.Element;
  state: ConnectState;
  inPlace: boolean;
  disabled?: boolean;
  /** Selected as a node in an editor. */
  selected?: boolean;
  onConnect: () => void;
}) {
  const done = () => connected(props.state);
  return (
    <button
      type="button"
      disabled={
        props.disabled ||
        props.state === 'connecting' ||
        props.state === 'waiting'
      }
      data-connect-app={props.appSlug}
      data-connect-target={props.target}
      data-connect-state={props.state}
      aria-label={done() ? `${props.name} connected` : `Connect ${props.name}`}
      class={cn(
        'pointer-events-auto inline-flex items-center gap-1 rounded-md border border-edge-muted bg-panel px-1.5 py-px align-middle text-xs font-medium text-ink',
        'cursor-default outline-none transition-colors',
        !done() &&
          props.state !== 'waiting' &&
          'not-touch:hover:border-accent/50 not-touch:hover:bg-accent-bg focus-visible:border-accent/50',
        props.selected && 'bg-active'
      )}
      // Keep the editor's selection where it was: this is an action, not a
      // caret target.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!done()) props.onConnect();
      }}
    >
      {props.icon('size-3.5')}
      {props.name}
      <Switch>
        <Match when={done()}>
          <CheckIcon class="size-3 text-success-ink" aria-hidden="true" />
        </Match>
        <Match when={props.state === 'connecting'}>
          <SpinnerIcon
            class="size-3 animate-spin text-ink-muted"
            aria-hidden="true"
          />
        </Match>
        <Match when={props.state === 'waiting'}>
          <span class="font-normal text-ink-subtle">not connected</span>
        </Match>
        <Match when={true}>
          <span
            class={cn(
              'ml-0.5 flex items-center gap-0.5 border-l border-edge-muted pl-1.5',
              props.state === 'failed' ? 'text-failure-ink' : 'text-accent'
            )}
          >
            {props.state === 'failed' ? 'Try again' : 'Connect'}
            <Show when={!props.inPlace}>
              <ArrowUpRightIcon class="size-3 opacity-70" aria-hidden="true" />
            </Show>
          </span>
        </Match>
      </Switch>
    </button>
  );
}
