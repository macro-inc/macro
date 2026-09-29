import { isMcpToolConnected } from '@app/features/setup/core/connectedTools';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { useEmailLinksQuery } from '@queries/email/link';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createMediaQuery } from '@solid-primitives/media';
import { Button, Tour, useTour } from '@ui';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { ViewTourVideo } from './components/ViewTourVideo';
import type {
  ViewTour as ViewTourDefinition,
  ViewTourConnector,
  ViewTourStep,
} from './core/view-tour';
import './view-tour.css';

/** Tours are a desktop affordance: wide viewports with a fine pointer. */
const DESKTOP_QUERY = '(min-width: 768px) and (pointer: fine)';

export type ViewTourProps = {
  tour: ViewTourDefinition;
  /** Extra calls to action shown under the step, e.g. an import shortcut. */
  actions?: JSX.Element;
};

/**
 * A view's automatic, dismissible tour. Mount it once inside the view; it
 * stays within the view's split and is saved as dismissed per user.
 */
export function ViewTour(props: ViewTourProps) {
  const userId = useUserId();
  const desktop = createMediaQuery(DESKTOP_QUERY);
  return (
    <Show when={desktop() && userId()} keyed>
      {(id) => <DismissibleTour {...props} userId={id} />}
    </Show>
  );
}

const isLocalTesting = () =>
  import.meta.env.DEV &&
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

function DismissibleTour(props: ViewTourProps & { userId: string }) {
  const storage = createUserScopedStorage(`macro:tour:${props.tour.id}`);
  // Localhost reopens tours on remount so they can be iterated on; saved
  // dismissals are left alone.
  const localTesting = isLocalTesting();
  const [dismissed, setDismissed] = createSignal(
    !localTesting && storage.read(props.userId) === 'hidden'
  );
  const dismiss = () => {
    setDismissed(true);
    if (!localTesting) storage.write(props.userId, 'hidden');
  };

  return (
    <Show when={!dismissed()}>
      <Tour.Root
        steps={props.tour.steps}
        onDismiss={dismiss}
        boundary={(root) => root.closest<HTMLElement>('[data-split-id]')}
      >
        <Tour.Highlight class="view-tour-highlight" />
        <Tour.Beacon />
        <Tour.Popover class="view-tour-card w-80 overflow-y-auto rounded-2xl border border-edge bg-dialog p-5 text-ink">
          <ViewTourCard tour={props.tour} actions={props.actions} />
        </Tour.Popover>
      </Tour.Root>
    </Show>
  );
}

function ViewTourCard(props: ViewTourProps) {
  const tour = useTour<ViewTourStep>();
  const missingHint = () =>
    tour.status() === 'floating' && tour.current().target
      ? tour.current().missingHint
      : undefined;

  return (
    <>
      <div class="mb-5 flex items-center gap-1 text-ink-muted">
        <p class="mr-auto text-[10px] uppercase tracking-widest">
          {props.tour.title} tour
        </p>
        <Tour.Previous />
        <Tour.Progress class="min-w-8 text-center text-[10px]" />
        <Tour.Next disabled={tour.isLast()} />
        <Tour.Close label={`Dismiss ${props.tour.title} tour`} />
      </div>
      <div aria-live="polite">
        <Tour.Title class="text-lg font-medium tracking-tight" />
        <Tour.Description class="mt-2 text-sm leading-6 text-ink-muted" />
      </div>
      <Show when={missingHint()}>
        {(hint) => (
          <p class="mt-3 text-xs leading-5 text-ink-extra-muted">{hint()}</p>
        )}
      </Show>
      <div class="mt-4 flex flex-wrap gap-2 empty:hidden">
        <Show when={props.tour.connector}>
          {(connector) => <ConnectAction connector={connector()} />}
        </Show>
        {props.actions}
      </div>
      <div class="mt-5 flex items-center justify-end">
        <Tour.Next variant="cta" size="sm" label={undefined} doneLabel="Got it">
          Next
        </Tour.Next>
      </div>
      <Show when={props.tour.video} keyed>
        {(video) => <ViewTourVideo video={video} />}
      </Show>
    </>
  );
}

/** Offers the connector until it's linked. Queries run only when mounted. */
function ConnectAction(props: { connector: ViewTourConnector }) {
  const { openSettingsInSplit } = useSettingsState();
  return (
    <Switch>
      <Match when={props.connector.kind === 'email'}>
        <EmailConnectAction
          label={props.connector.label}
          onConnect={() => openSettingsInSplit('Email')}
        />
      </Match>
      <Match when={props.connector.kind === 'mcp' && props.connector}>
        {(connector) => (
          <McpConnectAction
            label={connector().label}
            tools={connector().kind === 'mcp' ? connector().tools : []}
            onConnect={() => openSettingsInSplit('Connected')}
          />
        )}
      </Match>
    </Switch>
  );
}

function EmailConnectAction(props: { label: string; onConnect: () => void }) {
  const links = useEmailLinksQuery();
  // Unknown counts as connected so the button never flashes in.
  const connected = () =>
    !links.isSuccess || (links.data?.links.length ?? 0) > 0;
  return (
    <Show when={!connected()}>
      <ConnectButton label={props.label} onClick={props.onConnect} />
    </Show>
  );
}

function McpConnectAction(props: {
  label: string;
  tools: readonly string[];
  onConnect: () => void;
}) {
  const native = useMcpServersQuery({ neverSuspend: true });
  const pipedream = usePipedreamConnectionsQuery({ neverSuspend: true });
  const connected = () => {
    if (!native.isSuccess || !pipedream.isSuccess) return true;
    const sources = {
      native: native.data ?? [],
      pipedream: pipedream.data ?? [],
    };
    return props.tools.some((tool) => isMcpToolConnected(tool, sources));
  };
  return (
    <Show when={!connected()}>
      <ConnectButton label={props.label} onClick={props.onConnect} />
    </Show>
  );
}

function ConnectButton(props: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={props.onClick}>
      Connect {props.label}
    </Button>
  );
}

/** A call to action for `ViewTour`'s `actions` slot. */
export function ViewTourAction(props: {
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <Button variant="outline" size="sm" onClick={props.onClick}>
      {props.children}
    </Button>
  );
}
