import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ScreenCapabilities,
  ScreenTicketRequest,
} from '../context/screen-context';
import type {
  ScreenInputEvent,
  ScreenSessionHandlers,
  ScreenTransport,
} from '../transports/types';
import { createScreenSession } from './screen-session';

type FakeConnection = {
  handlers: ScreenSessionHandlers;
  sent: ScreenInputEvent[];
  controls: string[];
};

function fakeTransport(connections: FakeConnection[]): ScreenTransport {
  return {
    kind: 'vnc',
    connect: async (_element, _ticket, handlers) => {
      const connection: FakeConnection = { handlers, sent: [], controls: [] };
      connections.push(connection);
      return {
        sendInput: (event) => connection.sent.push(event),
        takeOver: () => connection.controls.push('takeOver'),
        handBack: (note) => connection.controls.push(`handBack:${note}`),
        stop: () => connection.controls.push('stop'),
        close: () => connection.controls.push('close'),
      };
    },
  };
}

/** Lets the session's awaited ticket and connect settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

describe('createScreenSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects with a drive ticket for a manager and only lets the driver send input', async () => {
    const tickets: ScreenTicketRequest[] = [];
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async (request) => {
        tickets.push(request);
        return ok({
          socketUrl: 'wss://screen.test/ws?ticket=t1',
          expiresAt: '',
        });
      },
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();

      expect(tickets).toEqual([
        {
          harnessId: 'harness-1',
          transport: 'vnc',
          surface: 'desktop',
          mode: 'drive',
        },
      ]);
      expect(session.store.status).toEqual({ kind: 'live' });

      // Not driving yet: input is dropped here, before the server's gate.
      session.sendInput({ kind: 'pointer', x: 1, y: 2, buttons: 0 });
      expect(connections[0].sent).toEqual([]);

      session.takeOver();
      expect(session.store.takingOver).toBe(true);
      connections[0].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
      });
      expect(session.store.takingOver).toBe(false);
      expect(session.drivingMe()).toBe(true);

      session.sendInput({ kind: 'pointer', x: 1, y: 2, buttons: 0 });
      expect(connections[0].sent).toEqual([
        { kind: 'pointer', x: 1, y: 2, buttons: 0 },
      ]);
      expect(connections[0].controls).toEqual(['takeOver']);
      dispose();
    });
  });

  it('reconnects with a new ticket after the socket drops', async () => {
    let issued = 0;
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        issued += 1;
        return ok({
          socketUrl: `wss://screen.test/ws?ticket=t${issued}`,
          expiresAt: '',
        });
      },
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => false,
        accessKnown: () => true,
        currentUserId: () => 'user-bob',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();

      connections[0].handlers.onEnded('connectionLost');
      expect(session.store.status).toEqual({
        kind: 'reconnecting',
        attempt: 1,
      });

      await vi.advanceTimersByTimeAsync(500);
      expect(issued).toBe(2);
      expect(session.store.status).toEqual({ kind: 'live' });
      dispose();
    });
  });

  it('shows a refused ticket as denied and does not retry', async () => {
    let issued = 0;
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        issued += 1;
        return err('forbidden');
      },
      transport: () => fakeTransport([]),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => false,
        accessKnown: () => true,
        currentUserId: () => 'user-carol',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(session.store.status).toEqual({
        kind: 'denied',
        reason: 'cannotWatch',
      });
      expect(issued).toBe(1);
      dispose();
    });
  });
  it('says when a drop cost this viewer the lease, and offers it back', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
      });
      expect(session.controlLost()).toBeUndefined();

      connections[0].handlers.onEnded('connectionLost');
      // Nobody is known to drive while the socket is gone, and the view says why.
      expect(session.drivingMe()).toBe(false);
      expect(session.controlLost()).toEqual({ kind: 'reconnecting' });

      await vi.advanceTimersByTimeAsync(500);
      expect(session.store.status).toEqual({ kind: 'live' });
      connections[1].handlers.onState({
        driver: { userId: 'user-bob', name: 'Bob' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 2,
      });
      expect(session.controlLost()).toEqual({
        kind: 'released',
        driver: { userId: 'user-bob', name: 'Bob' },
      });

      session.takeOver();
      expect(connections[1].controls).toEqual(['takeOver']);
      expect(session.controlLost()).toBeUndefined();
      dispose();
    });
  });

  it('says nothing when the server kept the lease across the reconnect', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      const drivenByAlice = {
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc' as const,
        viewers: 1,
      };
      connections[0].handlers.onState(drivenByAlice);
      connections[0].handlers.onEnded('shutdown');
      await vi.advanceTimersByTimeAsync(500);
      connections[1].handlers.onState(drivenByAlice);

      expect(session.drivingMe()).toBe(true);
      expect(session.controlLost()).toBeUndefined();
      dispose();
    });
  });
  it('says the computer is waking while the server wakes it, then connects', async () => {
    let handlers: ScreenSessionHandlers | undefined;
    let firstFrame: () => void = () => {};
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => ({
        kind: 'vnc',
        connect: async (_element, _ticket, connectHandlers) => {
          handlers = connectHandlers;
          await new Promise<void>((resolve) => {
            firstFrame = resolve;
          });
          return {
            sendInput: () => {},
            takeOver: () => {},
            handBack: () => {},
            stop: () => {},
            close: () => {},
          };
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      expect(session.store.status).toEqual({ kind: 'connecting' });

      const state = {
        driver: null,
        agentHeld: false,
        transport: 'vnc' as const,
        viewers: 1,
      };
      handlers?.onState({ ...state, waking: true });
      expect(session.store.status).toEqual({ kind: 'waking' });

      handlers?.onState({ ...state, waking: false });
      expect(session.store.status).toEqual({ kind: 'connecting' });

      firstFrame();
      await settle();
      expect(session.store.status).toEqual({ kind: 'live' });
      dispose();
    });
  });
  it('waits for access before the first ticket, and takes a drive ticket when Manage arrives later', async () => {
    const tickets: ScreenTicketRequest[] = [];
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async (request) => {
        tickets.push(request);
        return ok({
          socketUrl: 'wss://screen.test/ws?ticket=t1',
          expiresAt: '',
        });
      },
      transport: () => fakeTransport(connections),
    };
    const [accessKnown, setAccessKnown] = createSignal(false);
    const [canDrive, setCanDrive] = createSignal(false);

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive,
        accessKnown,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      // The harness list hasn't loaded: no ticket yet.
      expect(tickets).toEqual([]);
      expect(session.store.status).toEqual({ kind: 'connecting' });

      // It loads: this viewer manages the computer (owner or team admin).
      setCanDrive(true);
      setAccessKnown(true);
      await settle();
      expect(tickets.map((ticket) => ticket.mode)).toEqual(['drive']);
      dispose();
    });

    // A viewer whose access grows to Manage while watching reconnects to drive.
    tickets.length = 0;
    const [manages, setManages] = createSignal(false);
    await createRoot(async (dispose) => {
      createScreenSession({
        harnessId: 'harness-1',
        canDrive: manages,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      }).attach(document.createElement('div'));
      await settle();
      setManages(true);
      await settle();
      expect(tickets.map((ticket) => ticket.mode)).toEqual(['view', 'drive']);
      dispose();
    });
  });
  it('takes the lease back after a reconnect while driving, instead of showing a lease that drops input', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
        drivingHere: true,
      });
      expect(session.drivingMe()).toBe(true);

      connections[0].handlers.onEnded('connectionLost');
      await vi.advanceTimersByTimeAsync(500);
      // The new socket sees the old socket's lease: ours, but not here.
      connections[1].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
        drivingHere: false,
      });
      expect(session.drivingMe()).toBe(false);
      expect(connections[1].controls).toEqual(['takeOver']);

      connections[1].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
        drivingHere: true,
      });
      expect(session.drivingMe()).toBe(true);
      expect(session.controlLost()).toBeUndefined();
      dispose();
    });
  });

  it('offers Take over here, without taking over, in a new tab while the same user drives elsewhere', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 2,
        drivingHere: false,
      });

      expect(session.drivingMe()).toBe(false);
      expect(session.drivingElsewhere()).toBe(true);
      // Input from here would be dropped: it isn't sent.
      session.sendInput({ kind: 'pointer', x: 1, y: 2, buttons: 0 });
      expect(connections[0].sent).toEqual([]);
      expect(connections[0].controls).toEqual([]);

      session.takeOver();
      expect(connections[0].controls).toEqual(['takeOver']);

      // The harness accepts a hand-back from any tab of the driver.
      session.handBack('Back to you');
      expect(connections[0].controls).toEqual([
        'takeOver',
        'handBack:Back to you',
      ]);
      dispose();
    });
  });
  it('abandons a connect still waking when the view goes away, closing what it opened', async () => {
    let abandoned: AbortSignal | undefined;
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => ({
        kind: 'vnc',
        connect: (_element, _ticket, handlers, signal) => {
          abandoned = signal;
          handlers.onState({
            driver: null,
            agentHeld: false,
            waking: true,
            transport: 'vnc',
            viewers: 1,
          });
          // Never resolves: the computer is still waking.
          return new Promise(() => {});
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      expect(session.store.status).toEqual({ kind: 'waking' });
      expect(abandoned?.aborted).toBe(false);

      dispose();
      expect(abandoned?.aborted).toBe(true);
    });
  });

  it('hands back before Stop and before the view closes while driving, but not when a pop-out carries the lease', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };
    const drivenByAlice = {
      driver: { userId: 'user-alice', name: 'Alice' },
      agentHeld: true,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere: true,
    };
    const released: string[] = [];
    const open = async () =>
      createRoot(async (dispose) => {
        const session = createScreenSession({
          harnessId: 'harness-1',
          canDrive: () => true,
          accessKnown: () => true,
          currentUserId: () => 'user-alice',
          transport: () => 'vnc',
          capabilities,
        });
        session.setInputReleaser(() => released.push('released'));
        session.attach(document.createElement('div'));
        await settle();
        connections.at(-1)?.handlers.onState(drivenByAlice);
        return { session, dispose };
      });

    const stopping = await open();
    stopping.session.stop();
    expect(connections[0].controls).toEqual(['handBack:null', 'stop']);
    expect(released).toEqual(['released']);
    stopping.dispose();

    const closing = await open();
    closing.dispose();
    expect(connections[1].controls).toEqual(['handBack:null', 'close']);

    const poppingOut = await open();
    expect(poppingOut.session.carryLeaseAway()).toBe(true);
    poppingOut.dispose();
    expect(connections[2].controls).toEqual(['close']);
  });

  it('a popped-out view takes over the lease its old view left, once live', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        continueDriving: true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 2,
        drivingHere: false,
      });
      expect(connections[0].controls).toEqual(['takeOver']);
      dispose();
    });
  });

  it('does not take the lease back after a reconnect when it was handed back meanwhile', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
        drivingHere: true,
      });
      connections[0].handlers.onEnded('connectionLost');
      await vi.advanceTimersByTimeAsync(500);
      // Another tab of the same person handed back while this one was away.
      connections[1].handlers.onState({
        driver: null,
        agentHeld: false,
        waking: false,
        transport: 'vnc',
        viewers: 1,
        drivingHere: false,
      });

      expect(connections[1].controls).toEqual([]);
      expect(session.controlLost()).toEqual({ kind: 'released', driver: null });
      dispose();
    });
  });

  it('gives up on a connection that keeps dropping right after it goes live', async () => {
    let issued = 0;
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        issued += 1;
        return ok({
          socketUrl: 'wss://screen.test/ws?ticket=t1',
          expiresAt: '',
        });
      },
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => false,
        accessKnown: () => true,
        currentUserId: () => 'user-bob',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      // Each connection completes and drops within a second.
      for (let drop = 0; drop < 10; drop++) {
        if (session.store.status.kind === 'ended') break;
        connections.at(-1)?.handlers.onEnded('connectionLost');
        await vi.advanceTimersByTimeAsync(10_000);
      }

      expect(session.store.status).toEqual({ kind: 'ended', reason: 'failed' });
      expect(issued).toBeLessThanOrEqual(7);
      dispose();
    });
  });

  it('shows asleep, without retrying, when the server ends a connect before the handshake', async () => {
    let issued = 0;
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        issued += 1;
        return ok({
          socketUrl: 'wss://screen.test/ws?ticket=t1',
          expiresAt: '',
        });
      },
      transport: () => ({
        kind: 'vnc',
        // As vnc does: the end first, then the connect's own rejection.
        connect: async (_element, _ticket, handlers) => {
          handlers.onEnded('computerOff');
          throw new DOMException(
            'The screen connection was abandoned',
            'AbortError'
          );
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(session.store.status).toEqual({ kind: 'asleep' });
      expect(issued).toBe(1);
      dispose();
    });
  });

  it('hands back again after Stop watching and Watch again, and releases held input on an explicit hand-back', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };
    const drivenByAlice = {
      driver: { userId: 'user-alice', name: 'Alice' },
      agentHeld: true,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere: true,
    };
    const released: string[] = [];

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.setInputReleaser(() => released.push('released'));
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState(drivenByAlice);

      session.handBack('Your turn');
      expect(released).toEqual(['released']);
      expect(connections[0].controls).toEqual(['handBack:Your turn']);

      connections[0].handlers.onState(drivenByAlice);
      session.stop();
      connections[0].handlers.onEnded('stopped');
      session.retry();
      await settle();
      connections[1].handlers.onState(drivenByAlice);
      dispose();
      expect(connections[1].controls).toEqual(['handBack:null', 'close']);
    });
  });

  it('drops a connect that resolves after the view went away', async () => {
    let finish: () => void = () => {};
    let late: ScreenSessionHandlers | undefined;
    const closed: string[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => ({
        kind: 'vnc',
        connect: async (_element, _ticket, handlers) => {
          late = handlers;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return {
            sendInput: () => {},
            takeOver: () => {},
            handBack: () => {},
            switchSurface: () => {},
            stop: () => {},
            close: () => closed.push('closed'),
            stats: () => ({
              fps: undefined,
              kbps: 0,
              rttMs: undefined,
              decodeMs: undefined,
            }),
          };
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      dispose();
      // A transport that ignores the abort still resolves later: its session
      // is closed and never shown as live.
      finish();
      await settle();
      expect(closed).toEqual(['closed']);
      expect(session.store.status).not.toEqual({ kind: 'live' });
      // Nor does a late message from it change what the view shows.
      late?.onState({
        driver: null,
        agentHeld: false,
        waking: true,
        transport: 'vnc',
        viewers: 3,
      });
      expect(session.store.server).toBeUndefined();
    });
  });

  it('keeps the keyboard while it reconnects a session this tab drove, until the lease is settled', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };
    const state = (
      driver: { userId: string; name: string } | null,
      drivingHere: boolean
    ) => ({
      driver,
      agentHeld: driver !== null,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere,
    });
    const alice = { userId: 'user-alice', name: 'Alice' };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      expect(session.holdsKeyboard()).toBe(false);
      connections[0].handlers.onState(state(alice, true));
      expect(session.holdsKeyboard()).toBe(true);

      // A drop: not driving now, but the keys still aren't the app's.
      connections[0].handlers.onEnded('connectionLost');
      expect(session.drivingMe()).toBe(false);
      expect(session.holdsKeyboard()).toBe(true);

      // Back, with the lease on the old socket: taking it back keeps it.
      await vi.advanceTimersByTimeAsync(500);
      connections[1].handlers.onState(state(alice, false));
      expect(connections[1].controls).toEqual(['takeOver']);
      expect(session.holdsKeyboard()).toBe(true);
      connections[1].handlers.onState(state(alice, true));
      expect(session.drivingMe()).toBe(true);

      // Another drop, and meanwhile someone else took the lease: let go.
      connections[1].handlers.onEnded('connectionLost');
      expect(session.holdsKeyboard()).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      connections[2].handlers.onState(
        state({ userId: 'user-bob', name: 'Bob' }, false)
      );
      expect(session.holdsKeyboard()).toBe(false);
      dispose();
    });
  });

  it('gives up on resuming when the take-back is refused, instead of holding the keyboard until the lease lapses', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };
    const alice = { userId: 'user-alice', name: 'Alice' };
    const state = (drivingHere: boolean) => ({
      driver: alice,
      agentHeld: true,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere,
    });

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState(state(true));
      connections[0].handlers.onEnded('connectionLost');
      await vi.advanceTimersByTimeAsync(500);
      connections[1].handlers.onState(state(false));
      expect(connections[1].controls).toEqual(['takeOver']);
      expect(session.resumingDrive()).toBe(true);

      // The take-back is refused; the lease stays on the dropped socket.
      connections[1].handlers.onError({
        code: 'driveNotAllowed',
        message: 'no longer allowed to drive',
      });

      expect(session.resumingDrive()).toBe(false);
      expect(session.holdsKeyboard()).toBe(false);
      // The ordinary state for a lease held elsewhere: Take over here.
      expect(session.drivingElsewhere()).toBe(true);
      dispose();
    });
  });

  it('says a hidden tab was closed for going unwatched, gives up its drive, and reconnects as a viewer once shown', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility
    );
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        currentUserId: () => 'user-alice',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { userId: 'user-alice', name: 'Alice' },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
      });

      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      connections[0].handlers.onEnded('idle');
      expect(session.store.status).toEqual({ kind: 'ended', reason: 'idle' });
      // The server released the lease: nothing to win back, no keyboard held.
      expect(session.controlLost()).toBeUndefined();
      expect(session.holdsKeyboard()).toBe(false);
      // Hidden, it stays closed.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(connections).toHaveLength(1);

      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(connections).toHaveLength(2);
      expect(session.store.status).toEqual({ kind: 'live' });
      connections[1].handlers.onState({
        driver: null,
        agentHeld: false,
        waking: false,
        transport: 'vnc',
        viewers: 1,
      });
      expect(connections[1].controls).toEqual([]);
      expect(session.controlLost()).toBeUndefined();
      dispose();
    });
    vi.restoreAllMocks();
  });

  it('reconnects at once when it was closed for going unwatched while shown', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => false,
        accessKnown: () => true,
        currentUserId: () => 'user-bob',
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();

      connections[0].handlers.onEnded('idle');
      await settle();
      expect(connections).toHaveLength(2);
      expect(session.store.status).toEqual({ kind: 'live' });
      dispose();
    });
  });
});
