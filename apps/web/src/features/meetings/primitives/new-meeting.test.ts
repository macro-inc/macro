import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewMeetingCapabilities } from '../context/new-meeting';
import { createMeetingSession } from './meeting-session';
import { createMeetingSessionLifecycle } from './meeting-session-lifecycle';
import { createNewMeeting } from './new-meeting';

const alice = {
  id: 'macro|alice@example.com',
  name: 'Alice',
  email: 'alice@example.com',
};
const bob = {
  id: 'macro|bob@example.com',
  name: 'Bob',
  email: 'bob@example.com',
};
const meeting = {
  id: 'meeting-1',
  shareToken: 'meeting-secret',
  title: 'Quick Call',
};
const credentials = {
  callId: 'call-1',
  channelId: null,
  roomName: 'room',
  serverUrl: 'wss://example.com',
  token: 'rtc-token',
  participantId: 'host',
  shareToken: meeting.shareToken,
};
const preferences = { microphoneEnabled: false, cameraEnabled: false };
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup(overrides: Partial<NewMeetingCapabilities> = {}) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const events: string[] = [];
    const [people, setPeople] = createSignal([alice, bob]);
    const [activeCallId, setActiveCallId] = createSignal<string | null>(null);
    const create = vi.fn(async () => {
      events.push('create');
      return meeting;
    });
    const invite = vi.fn(async () => {
      events.push('ring');
    });
    const draft = createNewMeeting({ people, create, invite, ...overrides });
    const join = vi.fn(async () => {
      events.push('join');
      return credentials;
    });
    const connect = vi.fn(async () => {
      events.push('connect');
      setActiveCallId(credentials.callId);
    });
    const release = vi.fn(async () => undefined);
    const session = createMeetingSession({
      lifecycle: createMeetingSessionLifecycle(),
      prepare: draft.prepare,
      shareToken: () => draft.meeting()?.shareToken ?? '',
      isInCall: () => activeCallId() !== null,
      activeCallId,
      join,
      connect: async () => {
        await connect();
        await draft.ring();
      },
      disconnect: async () => {
        setActiveCallId(null);
      },
      release,
    });
    return {
      draft,
      session,
      create,
      invite,
      join,
      connect,
      release,
      events,
      setPeople,
    };
  });
}

describe('new meeting setup', () => {
  it('keeps selection local until Start, then creates, connects and rings once', async () => {
    const { draft, session, create, invite, events } = setup();
    draft.select(new Set([alice.id, bob.id]));
    expect(create).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
    await Promise.all([
      session.join(undefined, preferences),
      session.join(undefined, preferences),
    ]);
    expect(events).toEqual(['create', 'join', 'connect', 'ring']);
    expect(invite).toHaveBeenCalledExactlyOnceWith(meeting.shareToken, [
      alice.id,
      bob.id,
    ]);
    expect(session.joinedCallId()).toBe(credentials.callId);
  });

  it('starts without invitees and reuses its meeting without ringing again on rejoin', async () => {
    const { draft, session, create, invite } = setup();
    await session.join(undefined, preferences);
    expect(invite).not.toHaveBeenCalled();
    await session.leave();
    draft.select(new Set([alice.id]));
    await session.join(undefined, preferences);
    expect(create).toHaveBeenCalledOnce();
    expect(invite).toHaveBeenCalledOnce();
    await session.leave();
    await session.join(undefined, preferences);
    expect(invite).toHaveBeenCalledOnce();
  });

  it('keeps a successful creation on connection failure and rings only after retry connects', async () => {
    const { draft, session, create, invite, connect } = setup();
    draft.select(new Set([alice.id]));
    connect.mockRejectedValueOnce(new Error('offline'));
    await session.join(undefined, preferences);
    expect(invite).not.toHaveBeenCalled();
    expect(session.error()).toBeTruthy();
    await session.join(undefined, preferences);
    expect(create).toHaveBeenCalledOnce();
    expect(invite).toHaveBeenCalledOnce();
  });

  it('does not ring or join after cancelling a pending creation, and reuses that link on retry', async () => {
    let finish!: (value: typeof meeting) => void;
    const create = vi.fn(
      () =>
        new Promise<typeof meeting>((resolve) => {
          finish = resolve;
        })
    );
    const { draft, session, join, invite, release } = setup({ create });
    draft.select(new Set([alice.id]));
    const starting = session.join(undefined, preferences);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    await session.leave();
    finish(meeting);
    await starting;
    expect(join).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
    await session.join(undefined, preferences);
    expect(create).toHaveBeenCalledOnce();
    expect(invite).toHaveBeenCalledOnce();
    await session.leave();
    expect(release).toHaveBeenCalledWith(meeting.shareToken, credentials.token);
  });

  it('keeps the connected call if invitations fail and retries only the invitations', async () => {
    const { draft, session, invite, create, join, connect } = setup();
    draft.select(new Set([bob.id]));
    invite.mockRejectedValueOnce(new Error('offline'));
    await session.join(undefined, preferences);
    expect(session.joinedCallId()).toBe(credentials.callId);
    expect(session.error()).toBeUndefined();
    expect(draft.inviteError()).toBeTruthy();
    await draft.ring();
    expect(draft.inviteError()).toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
    expect(invite).toHaveBeenCalledTimes(2);
  });

  it('validates selected IDs against the latest roster before starting', async () => {
    const { draft, session, invite, setPeople } = setup();
    draft.select(new Set([alice.id, bob.id, 'bot|not-a-person']));
    expect([...draft.selected()]).toEqual([alice.id, bob.id]);
    setPeople([alice]);
    await session.join(undefined, preferences);
    expect(invite).toHaveBeenCalledExactlyOnceWith(meeting.shareToken, [
      alice.id,
    ]);
  });

  it('bounds the batch without silently replacing the previous selection', () => {
    const people = Array.from({ length: 51 }, (_, index) => ({
      id: `macro|user${index}@example.com`,
      name: `User ${index}`,
      email: `user${index}@example.com`,
    }));
    const { draft } = setup({ people: () => people });
    draft.select(new Set([people[0].id]));
    draft.select(new Set(people.map((person) => person.id)));
    expect([...draft.selected()]).toEqual([people[0].id]);
    expect(draft.selectionError()).toContain('50');
  });
});
