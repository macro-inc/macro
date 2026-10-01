import { VIEW_SHELL_TOUR } from '@app/components/view-shell/tour';
import { isMcpToolConnected } from '@app/features/setup/core/connectedTools';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableInAppTours } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { useEmailLinksQuery } from '@queries/email/link';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createMediaQuery } from '@solid-primitives/media';
import { Button } from '@ui';
import { Tour, useTour } from '@ui/components/Tour';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { ViewTourVideo } from './components/ViewTourVideo';
import type { TourProgress } from './core/progress';
import type {
  ViewTourConnector,
  ViewTour as ViewTourDefinition,
  ViewTourStep,
} from './core/view-tour';
import { createTourProgress } from './queries/tour-progress';
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
 * the view's split, and its progress is saved to the user's account.
 */
export function ViewTour(props: ViewTourProps) {
  const userId = useUserId();
  const desktop = createMediaQuery(DESKTOP_QUERY);
  const flag = useFeatureFlag(enableInAppTours);
  return (
    <Show when={flag().enabled && desktop() && userId()} keyed>
      {(id) => <DismissibleTour {...props} userId={id} />}
    </Show>
  );
}

const isLocalTesting = () =>
  import.meta.env.DEV &&
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

function DismissibleTour(props: ViewTourProps & { userId: string }) {
  // Localhost reopens tours from the start on every mount so they can be
  // iterated on, and leaves saved progress alone.
  const progress = createTourProgress({
    tourId: props.tour.id,
    userId: props.userId,
    localOnly: isLocalTesting(),
  });
  // Mount only once progress is known, so a finished tour never flashes up.
  return (
    <Show when={progress.ready()}>
      <ProgressTour
        {...props}
        initial={progress.stored()}
        onSave={progress.save}
      />
    </Show>
  );
}

function ProgressTour(
  props: ViewTourProps & {
    initial: TourProgress | undefined;
    onSave: (progress: TourProgress) => void;
  }
) {
  const [closed, setClosed] = createSignal(
    props.initial?.status === 'completed' ||
      props.initial?.status === 'dismissed'
  );
  const [step, setStep] = createSignal(
    props.initial?.status === 'active'
      ? Math.min(props.initial.step, props.tour.steps.length - 1)
      : 0
  );
  const changeStep = (next: number) => {
    setStep(next);
    props.onSave({ status: 'active', step: next });
  };
  const close = (status: 'completed' | 'dismissed') => {
    setClosed(true);
    props.onSave({ status });
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
        // Most hidden targets live in the view's collapsed sidebar.
        fallbackEntry={VIEW_SHELL_TOUR.sidebarToggle}
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

/** What to do to continue, shown beside the beacon while a step waits. */
function ViewTourHint(props: { tour: ViewTourDefinition }) {
  const tour = useTour<ViewTourStep>();
  return (
    <>
      <div class="flex items-center gap-2 text-xs text-ink-muted">
        <p class="mr-auto font-medium">{props.tour.title}</p>
        <Tour.Progress />
      </div>
      <p class="mt-1.5 text-sm leading-5">
        {tour.current().entryLabel ?? `Continue with ${props.tour.title}`}
      </p>
      <div class="mt-3">
        <Tour.Next variant="outline" size="md" doneLabel="Done">
          Skip
        </Tour.Next>
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
        <p class="mr-auto text-xs font-medium">{props.tour.title}</p>
        <Tour.Previous />
        <Tour.Progress class="min-w-10 text-center text-xs" />
        <Tour.Next disabled={tour.isLast()} />
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
      <div class="mt-5 flex items-center justify-end gap-2">
        <Tour.Close variant="ghost" size="md">
          Dismiss
        </Tour.Close>
        <Tour.Next variant="cta" size="md" doneLabel="Got it">
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
