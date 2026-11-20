import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
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

export type ScreenSessionOptions = {
  harnessId: string;
  /** Manage on the computer: connect with a drive ticket so Take over needs no reconnect. */
  canDrive: Accessor<boolean>;
  /**
   * Whether `canDrive` is known yet (the harness list has loaded). The first
   * ticket waits for it, so an owner never starts on a view ticket.
   */
  accessKnown: Accessor<boolean>;
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
    controlLost: false,
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
  const [attached, setAttached] = createSignal(false);

  const sessionSpan: Span = Telemetry.span('computer.screen.session');
  sessionSpan.setAttr('harness.id', options.harnessId);

  const teardown = () => {
    session?.close();
    session = undefined;
    element?.replaceChildren();
  };

  const apply = (step: NextStep, attempt: number) => {
    setStore({ status: step.status, takingOver: false });
    if (step.kind === 'show') {
      sessionSpan.event('computer.screen.status', { status: step.status.kind });
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

    const transportKind = options.transport();
    const mode = options.canDrive() ? 'drive' : 'view';
    connectedMode = mode;
    const connectSpan = sessionSpan.span('computer.screen.connect');
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
      apply(afterConnectFailed(ticket.error, attempt), attempt + 1);
      return;
    }

    let connected = false;
    try {
      const transport = options.capabilities.transport(transportKind);
      const opened = await transport.connect(target, ticket.value, {
        onState: (state) => {
          if (current !== generation) return;
          const driving =
            state.driver?.userId === options.currentUserId() &&
            state.drivingHere !== false;
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
        },
        onFrameSize: (size) => {
          if (current === generation) setStore('frame', size);
        },
        onError: (error) => {
          if (current !== generation) return;
          sessionSpan.event('computer.screen.error', { code: error.code });
          setStore({ notice: error, takingOver: false });
        },
        onEnded: (reason) => {
          if (current !== generation) return;
          sessionSpan.event('computer.screen.ended', { reason });
          session = undefined;
          forgetServer();
          // A session that went live starts its retries afresh.
          const step = afterSessionEnded(reason, connected ? 0 : attempt);
          // Over for good (stopped, revoked): there is no control to win back.
          if (step.kind === 'show') setStore('controlLost', false);
          apply(step, connected ? 1 : attempt + 1);
        },
      });
      if (current !== generation || disposed) {
        opened.close();
        return;
      }
      session = opened;
      connected = true;
      setStore({ status: { kind: 'live' }, notice: undefined });
      resumeDriving();
    } catch (error) {
      connectSpan.error(error);
      if (current === generation)
        apply(afterConnectFailed('failed', attempt), attempt + 1);
    } finally {
      connectSpan.end();
    }
  }

  onCleanup(() => {
    disposed = true;
    clearTimeout(retryTimer);
    teardown();
    sessionSpan.end();
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
        sessionSpan.event('computer.screen.upgrade_to_drive');
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

  /** We hold the lease, but from another tab or an older connection. */
  const drivingElsewhere = () =>
    ownLease() && store.server?.drivingHere === false;

  /**
   * This tab was driving when its connection ended (a drop, a reload of the
   * socket, a transport switch). Once the new connection is live, take the
   * lease back for it, unless someone else has it meanwhile: the old
   * socket's lease would otherwise show "You're driving" while dropping input.
   */
  function resumeDriving() {
    if (!store.controlLost || !session || store.status.kind !== 'live') return;
    if (!store.server || !options.canDrive()) return;
    if (drivingMe()) {
      setStore('controlLost', false);
      return;
    }
    if (store.server.driver && !drivingElsewhere()) return;
    sessionSpan.event('computer.screen.resume_driving');
    setStore({ takingOver: true, notice: undefined, controlLost: false });
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
    if (wasDriving) sessionSpan.event('computer.screen.control_lost');
    setStore({
      server: undefined,
      takingOver: false,
      controlLost: store.controlLost || wasDriving,
    });
  }

  const controlLost = (): ControlLost | undefined => {
    if (!store.controlLost) return undefined;
    const status = store.status.kind;
    if (
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
      sessionSpan.event('computer.screen.take_over');
      setStore({ takingOver: true, notice: undefined, controlLost: false });
      session.takeOver();
    },
    handBack(note: string | null) {
      sessionSpan.event('computer.screen.hand_back', {
        has_note: note !== null,
      });
      setStore('controlLost', false);
      session?.handBack(note);
    },
    stop() {
      sessionSpan.event('computer.screen.stop');
      session?.stop();
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
