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
        driver: { name: 'Alice', isYou: true },
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { name: 'Alice', isYou: true },
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
        driver: { name: 'Bob', isYou: false },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 2,
      });
      expect(session.controlLost()).toEqual({
        kind: 'released',
        driver: { name: 'Bob', isYou: false },
        reconnected: true,
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      const drivenByAlice = {
        driver: { name: 'Alice', isYou: true },
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { name: 'Alice', isYou: true },
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
        driver: { name: 'Alice', isYou: true },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
        drivingHere: false,
      });
      expect(session.drivingMe()).toBe(false);
      expect(connections[1].controls).toEqual(['takeOver']);

      connections[1].handlers.onState({
        driver: { name: 'Alice', isYou: true },
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { name: 'Alice', isYou: true },
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
      driver: { name: 'Alice', isYou: true },
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { name: 'Alice', isYou: true },
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { name: 'Alice', isYou: true },
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
      expect(session.controlLost()).toEqual({
        kind: 'released',
        driver: null,
        reconnected: true,
      });
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
      driver: { name: 'Alice', isYou: true },
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
      driver: { name: string; isYou: boolean } | null,
      drivingHere: boolean
    ) => ({
      driver,
      agentHeld: driver !== null,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere,
    });
    const alice = { name: 'Alice', isYou: true };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
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

      // Another drop, and meanwhile someone else took the lease: no drive
      // to win back, but stray keys stay swallowed until the person acts
      // on the banner.
      connections[1].handlers.onEnded('connectionLost');
      expect(session.holdsKeyboard()).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      connections[2].handlers.onState(
        state({ name: 'Bob', isYou: false }, false)
      );
      expect(session.resumingDrive()).toBe(false);
      expect(session.holdsKeyboard()).toBe(true);
      session.dismissControlLost();
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
    const alice = { name: 'Alice', isYou: true };
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { name: 'Alice', isYou: true },
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

  it('reconnects at once when it was closed as idle for having been hidden, and is shown again by then', async () => {
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
        canDrive: () => false,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();

      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      // The end for the hidden spell arrives after the tab is back.
      connections[0].handlers.onEnded('idle');
      await settle();
      expect(connections).toHaveLength(2);
      expect(session.store.status).toEqual({ kind: 'live' });
      dispose();
    });
    vi.restoreAllMocks();
  });

  it('retries with backoff and a cap, then offers Try again, when a tab shown all along keeps being closed as idle', async () => {
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();

      // Shown, yet closed as idle: not at once, but after a backoff.
      connections[0].handlers.onEnded('idle');
      await settle();
      expect(connections).toHaveLength(1);
      expect(session.store.status).toEqual({
        kind: 'reconnecting',
        attempt: 1,
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(connections).toHaveLength(2);

      // Each new socket is closed as idle right away: the retries run out.
      for (let round = 0; round < 10; round += 1) {
        const last = connections[connections.length - 1];
        last.handlers.onEnded('idle');
        await vi.advanceTimersByTimeAsync(10_000);
      }
      expect(session.store.status).toEqual({ kind: 'ended', reason: 'failed' });
      const made = connections.length;
      expect(made).toBeLessThanOrEqual(8);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(connections).toHaveLength(made);

      session.retry();
      await settle();
      expect(connections).toHaveLength(made + 1);
      dispose();
    });
  });

  it('says a drive that lapsed on a live connection is over and keeps the keyboard until the person acts, but not after a hand-back or a move to their own other tab', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };
    const state = (
      driver: { name: string; isYou: boolean } | null,
      drivingHere: boolean
    ) => ({
      driver,
      agentHeld: driver !== null,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere,
    });
    const alice = { name: 'Alice', isYou: true };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      const live = connections[0].handlers;

      // No input for a while: the server lets the lease go.
      live.onState(state(alice, true));
      live.onState(state(null, false));
      expect(session.controlLost()).toEqual({
        kind: 'released',
        driver: null,
        reconnected: false,
      });
      expect(session.holdsKeyboard()).toBe(true);
      // Nothing to win back: no take-over of its own. Holding Esc (a hand
      // back) just lets go: there's no lease to give.
      expect(connections[0].controls).toEqual([]);
      session.handBack(null);
      expect(connections[0].controls).toEqual([]);
      expect(session.holdsKeyboard()).toBe(false);

      // Someone else takes it.
      live.onState(state(alice, true));
      live.onState(state({ name: 'Bob', isYou: false }, false));
      expect(session.controlLost()).toMatchObject({
        kind: 'released',
        reconnected: false,
      });
      session.takeOver();
      live.onState(state(alice, true));
      expect(session.controlLost()).toBeUndefined();

      // Handed back from here: nothing lost.
      session.handBack(null);
      live.onState(state(null, false));
      expect(session.controlLost()).toBeUndefined();
      expect(session.holdsKeyboard()).toBe(false);

      // Taken over in another tab of the same person: nothing lost here.
      live.onState(state(alice, true));
      live.onState(state(alice, false));
      expect(session.controlLost()).toBeUndefined();
      dispose();
    });
  });

  it('hands back when the browser tab closes or reloads while driving, once', async () => {
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      connections[0].handlers.onState({
        driver: { name: 'Alice', isYou: true },
        agentHeld: true,
        waking: false,
        transport: 'vnc',
        viewers: 1,
      });

      window.dispatchEvent(new Event('pagehide'));
      expect(connections[0].controls).toEqual(['handBack:null']);
      dispose();
      expect(connections[0].controls).toEqual(['handBack:null', 'close']);
    });
  });

  it('wins back only the drive it dropped, not one the same person took over in another tab meanwhile', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };
    const state = (leaseId: string, drivingHere: boolean) => ({
      driver: { name: 'Alice', isYou: true },
      agentHeld: true,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere,
      leaseId,
    });

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();

      // The same drive, still on the dropped socket: won back.
      connections[0].handlers.onState(state('lease-1', true));
      connections[0].handlers.onEnded('connectionLost');
      await vi.advanceTimersByTimeAsync(500);
      connections[1].handlers.onState(state('lease-1', false));
      expect(connections[1].controls).toEqual(['takeOver']);
      connections[1].handlers.onState(state('lease-1', true));
      expect(session.drivingMe()).toBe(true);

      // Dropped again; meanwhile the person took over in another tab.
      connections[1].handlers.onEnded('connectionLost');
      await vi.advanceTimersByTimeAsync(5_000);
      connections[2].handlers.onState(state('lease-2', false));
      expect(connections[2].controls).toEqual([]);
      expect(session.resumingDrive()).toBe(false);
      expect(session.drivingElsewhere()).toBe(true);
      expect(session.controlLost()).toBeUndefined();
      expect(session.holdsKeyboard()).toBe(false);
      dispose();
    });
  });

  it('says the drive ended because the agent could not be kept paused, whichever comes first, the error or the lease change', async () => {
    const connections: FakeConnection[] = [];
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
      transport: () => fakeTransport(connections),
    };
    const state = (driver: { name: string; isYou: boolean } | null) => ({
      driver,
      agentHeld: driver !== null,
      waking: false,
      transport: 'vnc' as const,
      viewers: 1,
      drivingHere: driver !== null,
    });
    const alice = { name: 'Alice', isYou: true };
    const resumed = {
      code: 'agentNotPausable' as const,
      message:
        'The agent couldn’t be kept paused, so it has the computer back.',
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      const live = connections[0].handlers;

      // The error first, then the lease change.
      live.onState(state(alice));
      live.onError(resumed);
      live.onState(state(null));
      expect(session.controlLost()).toEqual({
        kind: 'released',
        driver: null,
        reconnected: false,
        reason: 'agentNotPausable',
      });
      // Not shown as a refused take-over; the keys stay held.
      expect(session.store.notice).toBeUndefined();
      expect(session.holdsKeyboard()).toBe(true);

      // Driving again forgets it; then the lease change first.
      session.takeOver();
      live.onState(state(alice));
      live.onState(state(null));
      expect(session.controlLost()).toMatchObject({ reason: undefined });
      live.onError(resumed);
      expect(session.controlLost()).toMatchObject({
        reason: 'agentNotPausable',
      });
      expect(session.store.notice).toBeUndefined();

      // Someone else takes over meanwhile: they have it now, not the agent.
      live.onState(state({ name: 'Bob', isYou: false }));
      expect(session.controlLost()).toEqual({
        kind: 'released',
        driver: { name: 'Bob', isYou: false },
        reconnected: false,
        reason: undefined,
      });
      dispose();
    });
  });

  it('recovers a blip quickly: after a steady connection drops, ten retries at most 2 s apart, then the usual backoff', async () => {
    const tickets: number[] = [];
    let failing = false;
    const connections: FakeConnection[] = [];
    const real = fakeTransport(connections);
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        tickets.push(Date.now());
        return ok({
          socketUrl: 'wss://screen.test/ws?ticket=t',
          expiresAt: '',
        });
      },
      transport: () => ({
        kind: 'vnc',
        connect: async (element, ticket, handlers, signal) => {
          if (failing) throw new Error('the tunnel is down');
          return real.connect(element, ticket, handlers, signal);
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => false,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      // Live a while, then the tunnel stays down.
      await vi.advanceTimersByTimeAsync(20_000);
      failing = true;
      const droppedAt = Date.now();
      connections[0].handlers.onEnded('error');
      await vi.advanceTimersByTimeAsync(120_000);

      const waits = tickets
        .slice(1)
        .map((at, index) => at - (index === 0 ? droppedAt : tickets[index]));
      expect(waits).toEqual([
        // Quick: ten tickets, within the harness's per-person budget.
        500, 1000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000,
        // Then the usual backoff carries on from 4 s rather than ending.
        4000, 8000, 10_000,
      ]);
      expect(session.store.status).toEqual({ kind: 'ended', reason: 'failed' });
      dispose();
    });
  });

  it('a blip that ends within the quick retries is live again in seconds', async () => {
    let failing = false;
    const connections: FakeConnection[] = [];
    const real = fakeTransport(connections);
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t', expiresAt: '' }),
      transport: () => ({
        kind: 'vnc',
        connect: async (element, ticket, handlers, signal) => {
          if (failing) throw new Error('the tunnel is down');
          return real.connect(element, ticket, handlers, signal);
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => false,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      await vi.advanceTimersByTimeAsync(20_000);
      failing = true;
      connections[0].handlers.onEnded('error');
      await vi.advanceTimersByTimeAsync(12_000);
      failing = false;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(session.store.status).toEqual({ kind: 'live' });
      dispose();
    });
  });

  it('waits out the ticket rate limit once, saying so, then leaves it to the person', async () => {
    let issued = 0;
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        issued += 1;
        return err('rateLimited' as const);
      },
      transport: () => fakeTransport([]),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      expect(session.store.status).toEqual({
        kind: 'reconnecting',
        attempt: 0,
        rateLimited: true,
      });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(issued).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(issued).toBe(2);
      expect(session.store.status).toEqual({
        kind: 'ended',
        reason: 'rateLimited',
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(issued).toBe(2);
      dispose();
    });
  });

  it('keeps the last picture on the stage while it reconnects, until the new connection is live', async () => {
    const connections: FakeConnection[] = [];
    let release = () => {};
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t', expiresAt: '' }),
      transport: () => ({
        kind: 'vnc',
        connect: async (element, _ticket, handlers) => {
          const picture = document.createElement('canvas');
          picture.dataset.connection = String(connections.length + 1);
          element.append(picture);
          const connection: FakeConnection = {
            handlers,
            sent: [],
            controls: [],
          };
          connections.push(connection);
          if (connections.length > 1)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return {
            sendInput: () => {},
            takeOver: () => {},
            handBack: () => {},
            stop: () => {},
            close: () => picture.remove(),
          };
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => false,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      const stage = document.createElement('div');
      // Nothing shown yet, so nothing to keep.
      expect(session.store.lastPicture).toBe(false);
      session.attach(stage);
      await settle();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(session.store.lastPicture).toBe(true);

      // The socket drops: the picture stays, the next connection mounts under it.
      connections[0].handlers.onEnded('connectionLost');
      await vi.advanceTimersByTimeAsync(500);
      expect(session.store.status.kind).toBe('reconnecting');
      expect(session.store.lastPicture).toBe(true);
      const pictures = () =>
        [...stage.children].map((child) => ({
          connection: (child as HTMLElement).dataset.connection,
          kept: child.hasAttribute('data-screen-last-picture'),
        }));
      expect(pictures()).toEqual([
        { connection: '1', kept: true },
        { connection: '2', kept: false },
      ]);

      // Live again: the kept picture gives way.
      release();
      await settle();
      expect(session.store.status).toEqual({ kind: 'live' });
      expect(pictures()).toEqual([{ connection: '2', kept: false }]);
      dispose();
    });
  });

  it('shows too many screens as its own end, without retrying or a last picture, and Try again connects', async () => {
    let issued = 0;
    let refuse = true;
    const connections: FakeConnection[] = [];
    const real = fakeTransport(connections);
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        issued += 1;
        return ok({
          socketUrl: 'wss://screen.test/ws?ticket=t',
          expiresAt: '',
        });
      },
      transport: () => ({
        kind: 'vnc',
        // As the harness does: the error, the end, then the socket closes
        // before the handshake.
        connect: async (element, ticket, handlers, signal) => {
          if (!refuse) return real.connect(element, ticket, handlers, signal);
          handlers.onError({
            code: 'tooManySockets',
            message: 'too many screens are open on this computer',
          });
          handlers.onEnded('error');
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
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(session.store.status).toEqual({
        kind: 'ended',
        reason: 'tooManyScreens',
      });
      expect(session.store.notice).toBeUndefined();
      expect(session.store.lastPicture).toBe(false);
      expect(issued).toBe(1);

      refuse = false;
      session.retry();
      await settle();
      expect(session.store.status).toEqual({ kind: 'live' });
      expect(issued).toBe(2);
      dispose();
    });
  });

  it('shows too many screens, without retrying, when the ticket itself is refused for it', async () => {
    let issued = 0;
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        issued += 1;
        return err('tooManyScreens' as const);
      },
      transport: () => fakeTransport([]),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(session.store.status).toEqual({
        kind: 'ended',
        reason: 'tooManyScreens',
      });
      expect(issued).toBe(1);
      dispose();
    });
  });

  it('after Turn on, says it is turning the computer on and rides out the boot, then is live', async () => {
    const tickets: number[] = [];
    let up = false;
    const connections: FakeConnection[] = [];
    const real = fakeTransport(connections);
    const capabilities: ScreenCapabilities = {
      requestTicket: async () => {
        tickets.push(Date.now());
        return ok({
          socketUrl: 'wss://screen.test/ws?ticket=t',
          expiresAt: '',
        });
      },
      transport: () => ({
        kind: 'vnc',
        connect: async (element, ticket, handlers, signal) => {
          if (up) return real.connect(element, ticket, handlers, signal);
          // Booting: the guest's screen isn't reachable yet.
          handlers.onError({
            code: 'tunnelFailed',
            message: "could not reach the computer's screen",
          });
          handlers.onEnded('error');
          throw new DOMException('closed', 'AbortError');
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      await settle();
      expect(tickets).toHaveLength(1);

      // Turn on: said at once, before the power call answers.
      session.turningOn();
      expect(session.store.status).toEqual({ kind: 'waking', turningOn: true });
      session.turnedOn();
      await vi.advanceTimersByTimeAsync(20_000);

      // Twenty seconds of boot: still turning on, no reconnect error shown,
      // tried every 2 s.
      expect(session.store.status).toEqual({ kind: 'waking', turningOn: true });
      expect(session.store.notice).toBeUndefined();
      expect(tickets.length).toBeGreaterThanOrEqual(10);

      up = true;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(session.store.status).toEqual({ kind: 'live' });
      dispose();
    });
  });

  it('gives a boot two minutes, then counts failures as it would otherwise', async () => {
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t', expiresAt: '' }),
      transport: () => ({
        kind: 'vnc',
        connect: async () => {
          throw new Error('never comes up');
        },
      }),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.attach(document.createElement('div'));
      session.turningOn();
      session.turnedOn();
      await vi.advanceTimersByTimeAsync(119_000);
      expect(session.store.status.kind).toBe('waking');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(session.store.status.kind).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(session.store.status).toEqual({ kind: 'ended', reason: 'failed' });
      dispose();
    });
  });

  it('goes back to asleep when the power call fails', async () => {
    const capabilities: ScreenCapabilities = {
      requestTicket: async () =>
        ok({ socketUrl: 'wss://screen.test/ws?ticket=t', expiresAt: '' }),
      transport: () => fakeTransport([]),
    };

    await createRoot(async (dispose) => {
      const session = createScreenSession({
        harnessId: 'harness-1',
        canDrive: () => true,
        accessKnown: () => true,
        transport: () => 'vnc',
        capabilities,
      });
      session.turningOn();
      session.turnOnFailed();
      expect(session.store.status).toEqual({ kind: 'asleep' });
      dispose();
    });
  });
});
