import { isMcpToolConnected } from '@app/features/setup/core/connectedTools';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { useEmailLinksQuery } from '@queries/email/link';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createMediaQuery } from '@solid-primitives/media';
import { Button } from '@ui';
import { Tour, useTour } from '@ui/components/Tour';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { ViewTourVideo } from './components/ViewTourVideo';
import type {
  ViewTourConnector,
  ViewTour as ViewTourDefinition,
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
 * A view's automatic tour. Mount it once inside the view; it stays within
 * the view's split, and its progress is saved per user on this browser.
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

/**
 * Saved per user and tour on this browser: finished or dismissed tours stay
 * hidden, and an unfinished tour resumes at the step the user last reached.
 */
type TourProgress =
  | { status: 'completed' | 'dismissed' }
  | { status: 'active'; step: number };

function readProgress(raw: string | null): TourProgress | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<TourProgress & { step: unknown }>;
    if (value.status === 'completed' || value.status === 'dismissed')
      return { status: value.status };
    if (value.status === 'active' && typeof value.step === 'number')
      return { status: 'active', step: value.step };
  } catch {
    // Unreadable progress starts the tour fresh.
  }
  return undefined;
}

function DismissibleTour(props: ViewTourProps & { userId: string }) {
  const storage = createUserScopedStorage(`macro:tour:${props.tour.id}`);
  // Localhost reopens tours from the start on every mount so they can be
  // iterated on, and leaves saved progress alone.
  const localTesting = isLocalTesting();
  const saved = localTesting
    ? undefined
    : readProgress(storage.read(props.userId));
  const [closed, setClosed] = createSignal(
    saved?.status === 'completed' || saved?.status === 'dismissed'
  );
  const [step, setStep] = createSignal(
    saved?.status === 'active'
      ? Math.min(saved.step, props.tour.steps.length - 1)
      : 0
  );
  const save = (progress: TourProgress) => {
    if (!localTesting) storage.write(props.userId, JSON.stringify(progress));
  };
  const changeStep = (next: number) => {
    setStep(next);
    save({ status: 'active', step: next });
  };
  const close = (status: 'completed' | 'dismissed') => {
    setClosed(true);
    save({ status });
  };

  return (
    <Show when={!closed()}>
      <Tour.Root
        steps={props.tour.steps}
        step={step()}
        onStepChange={changeStep}
        onDismiss={() => close('dismissed')}
        onComplete={() => close('completed')}
        boundary={(root) => root.closest<HTMLElement>('[data-split-id]')}
      >
        <Tour.Highlight class="view-tour-highlight" />
        <Tour.Beacon />
        <Tour.Hint class="view-tour-hint w-64 rounded-xl border border-edge bg-dialog p-3 text-ink">
          <ViewTourHint tour={props.tour} />
        </Tour.Hint>
        <Tour.Popover class="view-tour-card w-80 overflow-y-auto rounded-2xl border border-edge bg-dialog p-5 text-ink">
          <ViewTourCard tour={props.tour} actions={props.actions} />
        </Tour.Popover>
      </Tour.Root>
    </Show>
  );
}

const entryKey = (step: ViewTourStep) =>
  [step.entry ?? []]
    .flat()
    .map((entry) => entry.id)
    .join('|');

/**
 * What to do to continue, shown beside the beacon while a step waits. After
 * one Skip, Skip all appears when more steps wait on the same action.
 */
function ViewTourHint(props: { tour: ViewTourDefinition }) {
  const tour = useTour<ViewTourStep>();
  const [skippedPath, setSkippedPath] = createSignal<string>();
  const canSkipAll = () =>
    skippedPath() === entryKey(tour.current()) && tour.pathEnd() > tour.index();
  return (
    <>
      <p class="text-[10px] uppercase tracking-widest text-ink-muted">
        {props.tour.title} tour · <Tour.Progress />
      </p>
      <p class="mt-1.5 text-sm leading-5">
        {tour.current().entryLabel ?? `Continue the ${props.tour.title} tour`}
      </p>
      <div class="mt-3 flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSkippedPath(entryKey(tour.current()));
            tour.next();
          }}
        >
          Skip
        </Button>
        <Show when={canSkipAll()}>
          <Button variant="ghost" size="sm" onClick={tour.skipPath}>
            Skip all
          </Button>
        </Show>
      </div>
    </>
  );
}

function ViewTourCard(props: ViewTourProps) {
  const tour = useTour<ViewTourStep>();
  // Explain how to reach the feature when the tour can't point at it, or
  // points at a stand-in because it isn't set up yet.
  const missingHint = () =>
    (tour.status() === 'floating' && tour.current().target) || tour.isFallback()
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
        <Tour.Next variant="cta" size="sm" doneLabel="Got it">
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
