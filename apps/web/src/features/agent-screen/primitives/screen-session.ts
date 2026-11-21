import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ScreenCapabilities } from '../context/screen-context';
import {
  afterConnectFailed,
  afterSessionEnded,
  type ControlLost,
  type NextStep,
  type ScreenStatus,
} from '../core/screen-status';
import type {
  ScreenError,
  ScreenFrameSize,
  ScreenInputEvent,
  ScreenRect,
  ScreenSession,
  ScreenState,
  ScreenTransportKind,
} from '../transports/types';

/** A connection that drops sooner than this after going live is flapping. */
const FLAPPING_MS = 10_000;

export type ScreenSessionOptions = {
  harnessId: string;
  /** Manage on the computer: connect with a drive ticket so Take over needs no reconnect. */
  canDrive: Accessor<boolean>;
  /**
   * Whether `canDrive` is known yet (the harness list has loaded). The first
   * ticket waits for it, so an owner never starts on a view ticket.
   */
  accessKnown: Accessor<boolean>;
  /**
   * This view takes over from another view of the same viewer that was
   * driving (a pop-out): once live, take the lease it left behind.
   */
  continueDriving?: boolean;
  /** The view's load flow (`useFlow().span`): the first connection is its phase. */
  parentSpan?: () => Span;
  currentUserId: Accessor<string | undefined>;
  transport: Accessor<ScreenTransportKind>;
  capabilities: ScreenCapabilities;
};

type SessionStore = {
  status: ScreenStatus;
  frame: ScreenFrameSize | undefined;
  server: ScreenState | undefined;
  /** Take over sent, waiting for the server's state to name us. */
  takingOver: boolean;
  /** The last error the server reported on an open socket. */
  notice: ScreenError | undefined;
  /**
   * This viewer was driving when its connection ended (a drop, a server
   * restart, a transport switch), and hasn't seen the server confirm it still
   * holds the lease. Cleared by that confirmation, Take over, Hand back or a
   * dismissal; never silently.
   */
  controlLost: boolean;
};

/**
 * One viewer's connection to an agent computer's screen: tickets, the
 * transport session, reconnects, and the driver lease as the server reports
 * it. The view mounts the media element and hands it over with `attach`.
 *
 * Owners and admins connect with a drive ticket from the start, so taking
 * over is one control message; everyone else connects to view.
 */
export function createScreenSession(options: ScreenSessionOptions) {
  const [store, setStore] = createStore<SessionStore>({
    status: { kind: 'connecting' },
    frame: undefined,
    server: undefined,
    takingOver: false,
    notice: undefined,
    controlLost: options.continueDriving ?? false,
  });

  let element: HTMLElement | undefined;
  let session: ScreenSession | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  // Each connect attempt has its own generation; a late result from an older
  // one is dropped.
  let generation = 0;
  let disposed = false;
  /** The mode of the ticket the current connection was opened with. */
  let connectedMode: 'view' | 'drive' | undefined;
  let firstConnect = true;
  /** Abandons the connect in flight, if any (see `ScreenTransport.connect`). */
  let pendingConnect: AbortController | undefined;
  /** When the current connection went live, to tell a flapping one apart. */
  let liveSince: number | undefined;
  /** Set by a pop-out: the lease goes with the view that replaces this one. */
  let leaseCarriedAway = false;
  /** Stop already handed back; closing must not do it twice. */
  let handedBackOnLeaving = false;
  /** Releases keys and buttons held in the guest (the input controller's). */
  let releaseInput: () => void = () => {};
  const [attached, setAttached] = createSignal(false);

  /**
   * One span per connection, from its ticket until it ends (never one for
   * the whole view): the first is a phase of the view's load flow when there
   * is one, later ones (reconnects) start their own traces. What happens on a
   * connection (take over, hand back, errors) is an event on it.
   */
  let connectionSpan: Span | undefined;
  const endConnectionSpan = (outcome: string) => {
    connectionSpan?.setAttr('computer.screen.outcome', outcome);
    connectionSpan?.end();
    connectionSpan = undefined;
  };
  /** An event on the current connection, or a span of its own between them. */
  const record = (
    name: string,
    attributes?: Record<string, string | boolean>
  ) => {
    if (connectionSpan) {
      connectionSpan.event(name, attributes);
      return;
    }
    const span = Telemetry.span(name, {
      attributes: { 'harness.id': options.harnessId, ...attributes },
    });
    span.end();
  };

  const teardown = () => {
    pendingConnect?.abort();
    pendingConnect = undefined;
    session?.close();
    session = undefined;
    element?.replaceChildren();
  };

  /**
   * Leaving on purpose while driving (closing the pane, Stop) hands back
   * first, so the agent resumes at once instead of waiting out the lease. A
   * new connection does not: it keeps the lease through `controlLost` and
   * `resumeDriving`, and an unplanned drop keeps the lease's grace.
   */
  const handBackIfDriving = () => {
    if (!session || !drivingMe() || leaseCarriedAway || handedBackOnLeaving)
      return;
    handedBackOnLeaving = true;
    record('computer.screen.hand_back', { reason: 'leaving' });
    releaseInput();
    session.handBack(null);
  };

  const apply = (step: NextStep, attempt: number) => {
    // Over for good (stopped, revoked, refused, gave up): there is no drive
    // to win back, and the keyboard goes back to the app.
    setStore({
      status: step.status,
      takingOver: false,
      ...(step.kind === 'show' ? { controlLost: false } : {}),
    });
    if (step.kind === 'show') {
      record('computer.screen.status', { status: step.status.kind });
      return;
    }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(
      () => fireAndForget(connect(attempt), 'agent-screen.reconnect'),
      step.delayMs
    );
  };

  async function connect(attempt: number) {
    if (disposed || !element) return;
    const current = ++generation;
    const target = element;
    forgetServer();
    teardown();
    // A new connection can be left (and handed back) again.
    handedBackOnLeaving = false;
    const abandon = new AbortController();
    pendingConnect = abandon;

    const transportKind = options.transport();
    const mode = options.canDrive() ? 'drive' : 'view';
    connectedMode = mode;
    endConnectionSpan('replaced');
    const parent = firstConnect ? options.parentSpan?.() : undefined;
    firstConnect = false;
    connectionSpan = parent
      ? parent.span('computer.screen.connection')
      : Telemetry.span('computer.screen.connection');
    connectionSpan.setAttr('harness.id', options.harnessId);
    const connectSpan = connectionSpan.span('computer.screen.connect');
    connectSpan.setAttr('harness.id', options.harnessId);
    connectSpan.setAttr('screen.transport', transportKind);
    connectSpan.setAttr('screen.mode', mode);
    connectSpan.setAttr('screen.attempt', attempt);

    const ticket = await options.capabilities.requestTicket(
      {
        harnessId: options.harnessId,
        transport: transportKind,
        surface: 'desktop',
        mode,
      },
      connectSpan
    );
    if (current !== generation || disposed) {
      connectSpan.end();
      return;
    }
    if (ticket.isErr()) {
      connectSpan.setAttr('screen.ticket_failure', ticket.error);
      connectSpan.end();
      endConnectionSpan(`ticket_${ticket.error}`);
      apply(afterConnectFailed(ticket.error, attempt), attempt + 1);
      return;
    }

    let connected = false;
    // The server ended this attempt itself (computer off, access revoked):
    // that end is what the viewer shows, not the connect's later rejection.
    let endedByServer = false;
    try {
      const transport = options.capabilities.transport(transportKind);
      const opened = await transport.connect(
        target,
        ticket.value,
        {
          onState: (state) => {
            if (current !== generation) return;
            const driving =
              state.driver?.userId === options.currentUserId() &&
              state.drivingHere !== false;
            // One update, so a lease being taken back never shows as lost.
            batch(() => {
              setStore({
                server: state,
                takingOver: store.takingOver && !driving,
                // The server kept our lease across the reconnect.
                controlLost: store.controlLost && !driving,
              });
              resumeDriving();
              // Until the first frame, say the computer is waking while it is.
              if (store.status.kind !== 'live') {
                if (state.waking) setStore('status', { kind: 'waking' });
                else if (store.status.kind === 'waking')
                  setStore('status', { kind: 'connecting' });
              }
            });
          },
          onFrameSize: (size) => {
            if (current === generation) setStore('frame', size);
          },
          onError: (error) => {
            if (current !== generation) return;
            record('computer.screen.error', { code: error.code });
            setStore({ notice: error, takingOver: false });
          },
          onEnded: (reason) => {
            if (current !== generation) return;
            endedByServer = true;
            record('computer.screen.ended', { reason });
            endConnectionSpan(reason);
            session = undefined;
            // A session that stayed live a while starts its retries afresh; one
            // that keeps dropping right after going live counts on.
            if (connected && flapping()) connected = false;
            const step = afterSessionEnded(reason, connected ? 0 : attempt);
            // One update: nothing (the keyboard, the controls) may see the
            // in-between of "ended" before "reconnecting".
            batch(() => {
              forgetServer();
              apply(step, connected ? 1 : attempt + 1);
            });
          },
        },
        abandon.signal
      );
      if (pendingConnect === abandon) pendingConnect = undefined;
      if (current !== generation || disposed) {
        opened.close();
        return;
      }
      session = opened;
      connected = true;
      liveSince = Date.now();
      batch(() => {
        setStore({ status: { kind: 'live' }, notice: undefined });
        resumeDriving();
      });
    } catch (error) {
      connectSpan.error(error);
      if (current !== generation || endedByServer) return;
      endConnectionSpan('connect_failed');
      apply(afterConnectFailed('failed', attempt), attempt + 1);
    } finally {
      connectSpan.end();
    }
  }

  /** Went live less than `FLAPPING_MS` ago: the drop doesn't reset retries. */
  function flapping() {
    return liveSince !== undefined && Date.now() - liveSince < FLAPPING_MS;
  }

  onCleanup(() => {
    handBackIfDriving();
    disposed = true;
    // Late results from any attempt in flight are dropped from here on.
    generation += 1;
    clearTimeout(retryTimer);
    teardown();
    endConnectionSpan('closed');
  });

  // The first connect waits for the element and for access to be known.
  createEffect(
    on(
      () => attached() && options.accessKnown(),
      (ready, wasReady) => {
        if (ready && !wasReady)
          fireAndForget(connect(0), 'agent-screen.connect');
      }
    )
  );

  // Access that arrives (or grows to Manage) after a view connection: take a
  // drive ticket, so Take over is one message rather than driveNotAllowed.
  createEffect(
    on(
      options.canDrive,
      (canDrive) => {
        if (!canDrive || connectedMode !== 'view') return;
        if (store.status.kind !== 'live') return;
        record('computer.screen.upgrade_to_drive');
        fireAndForget(connect(0), 'agent-screen.connect');
      },
      { defer: true }
    )
  );

  const ownLease = () => {
    const driver = store.server?.driver;
    return !!driver && driver.userId === options.currentUserId();
  };

  /** This tab drives: the lease is ours and accepts this socket's input. */
  const drivingMe = () => ownLease() && store.server?.drivingHere !== false;

  /** The lease is ours, on another socket: another tab, or an older connection. */
  const leaseOnOtherSocket = () =>
    ownLease() && store.server?.drivingHere === false;

  /**
   * We hold the lease from another tab. Not while resuming: then the other
   * socket is this tab's own dropped one, and the lease is about to move here.
   */
  const drivingElsewhere = () => leaseOnOtherSocket() && !resumingDrive();

  /**
   * This tab was driving when its connection ended (a drop, a reload of the
   * socket, a transport switch). Once the new connection is live, take the
   * lease back for it, unless someone else has it meanwhile: the old
   * socket's lease would otherwise show "You're driving" while dropping input.
   */
  function resumeDriving() {
    if (!store.controlLost || !session || store.status.kind !== 'live') return;
    if (store.takingOver) return;
    if (!store.server || !options.canDrive()) return;
    if (drivingMe()) {
      setStore('controlLost', false);
      return;
    }
    // Only a lease that is still ours: when it is free, someone (perhaps us,
    // from another tab) handed back on purpose, and the banner offers it.
    if (!leaseOnOtherSocket()) return;
    record('computer.screen.resume_driving');
    // `controlLost` stays until the server answers: the drive is still
    // being won back (`resumingDrive`).
    setStore({ takingOver: true, notice: undefined });
    session.takeOver();
  }

  /**
   * The server state belongs to the connection that reported it: when that
   * connection ends, nobody is known to drive until the next one says so. If
   * it was us, remember it so the view can say so (`controlLost`).
   */
  function forgetServer() {
    if (!store.server) return;
    const wasDriving = drivingMe();
    if (wasDriving) record('computer.screen.control_lost');
    setStore({
      server: undefined,
      takingOver: false,
      controlLost: store.controlLost || wasDriving,
    });
  }

  /**
   * The viewer keeps the keyboard (keys swallowed, never the app's hotkeys)
   * while it drives, and while it wins back a drive a drop interrupted: until
   * the new connection settles the lease, the person is still typing at the
   * remote computer.
   */
  const holdsKeyboard = () => drivingMe() || resumingDrive();

  /**
   * A drive this tab lost to a drop is being won back: from the end, through
   * reconnecting, until the new connection says whose lease it is (and while
   * taking it back).
   */
  const resumingDrive = () =>
    store.controlLost &&
    options.canDrive() &&
    (!store.server || store.takingOver || leaseOnOtherSocket());

  const controlLost = (): ControlLost | undefined => {
    if (!store.controlLost) return undefined;
    const status = store.status.kind;
    if (
      resumingDrive() ||
      status === 'reconnecting' ||
      status === 'connecting' ||
      status === 'waking'
    ) {
      return { kind: 'reconnecting' };
    }
    if (status !== 'live' || !store.server || drivingMe()) return undefined;
    return { kind: 'released', driver: store.server.driver };
  };

  return {
    store,
    drivingMe,
    drivingElsewhere,
    controlLost,
    holdsKeyboard,
    resumingDrive,
    /** The person read the control-lost banner and closed it. */
    dismissControlLost() {
      setStore('controlLost', false);
    },
    /** The element the transport renders into; connecting starts here. */
    attach(next: HTMLElement) {
      element = next;
      setAttached(true);
    },
    /** Try again now: after giving up, or after the computer was turned on. */
    retry() {
      clearTimeout(retryTimer);
      setStore({ status: { kind: 'connecting' } });
      fireAndForget(connect(0), 'agent-screen.connect');
    },
    sendInput(event: ScreenInputEvent) {
      if (drivingMe()) session?.sendInput(event);
    },
    takeOver() {
      if (!session || !options.canDrive()) return;
      record('computer.screen.take_over');
      setStore({ takingOver: true, notice: undefined, controlLost: false });
      session.takeOver();
    },
    handBack(note: string | null) {
      record('computer.screen.hand_back', {
        has_note: note !== null,
      });
      setStore('controlLost', false);
      releaseInput();
      session?.handBack(note);
    },
    stop() {
      record('computer.screen.stop');
      handBackIfDriving();
      session?.stop();
    },
    /**
     * This view is being replaced by another of the same viewer (a pop-out):
     * don't hand back on the way out; the new view takes the lease over.
     */
    carryLeaseAway() {
      leaseCarriedAway = drivingMe();
      return leaseCarriedAway;
    },
    /** How to let go of keys and buttons held in the guest before handing back. */
    setInputReleaser(release: () => void) {
      releaseInput = release;
    },
    /**
     * A copy of a guest region, from a transport that draws where the app
     * can't read it (vnc); `undefined` from the others, whose canvas or video
     * the loupe reads directly.
     */
    snapshot(rect: ScreenRect): Promise<ImageBitmap | undefined> | undefined {
      return session?.snapshot?.(rect);
    },
  };
}

export type ScreenSessionController = ReturnType<typeof createScreenSession>;
