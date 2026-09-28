import { createRoot, createSignal, type Setter } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGameLog } from '../core/game-document';
import { pongRules } from '../core/games/pong';
import { parseGamePresence } from '../core/presence';
import { createRandom } from '../core/random';
import { createLinkedRoomSources } from '../tests/linked-room-sources';
import { createGameRoom } from './create-game-room';
import { createPong } from './create-pong';
import { createTurnMatch } from './create-turn-match';

const ANN = 'macro|ann@macro.com';
const BOB = 'macro|bob@macro.com';

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  vi.useRealTimers();
});

function fakeFrames() {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
}

/**
 * Clients of one Pong room, one per user entry (a user may have two tabs).
 * Clients listed in `idle` publish presence but run nothing; clients listed
 * in `hidden` open in a background tab.
 */
function setupRoom(
  users: readonly string[],
  {
    idle = [],
    hidden = [],
  }: { idle?: readonly number[]; hidden?: readonly number[] } = {}
) {
  const linked = createLinkedRoomSources(users);
  const roots = new Map<number, () => void>();
  const shown = new Map<number, Setter<boolean>>();
  const clients = users.map((user, index) => {
    if (idle.includes(index)) return undefined;
    return createRoot((dispose) => {
      roots.set(index, dispose);
      disposers.push(dispose);
      const room = createGameRoom({
        source: linked.sources[index],
        userId: () => user,
        canEdit: () => true,
        requestedKind: () => 'pong',
      });
      const match = createTurnMatch(room, pongRules);
      const [visible, setVisible] = createSignal(!hidden.includes(index));
      shown.set(index, setVisible);
      const pong = createPong(room, match, {
        random: createRandom(3),
        visible,
      });
      return { room, match, pong };
    });
  });
  /** Stop a client like a closed tab; its last presence lingers a while. */
  const close = (index: number) => roots.get(index)?.();
  /** Background or foreground a client's tab; hidden tabs get no frames. */
  const setVisible = (index: number, visible: boolean) =>
    shown.get(index)?.(visible);
  return { linked, clients, close, setVisible };
}

function setupMatch() {
  const { linked, clients } = setupRoom([ANN, BOB]);
  const [ann, bob] = clients;
  if (!ann || !bob) throw new Error('clients missing');
  return { linked, ann, bob };
}

type Client = NonNullable<ReturnType<typeof setupRoom>['clients'][number]>;

/**
 * Advance in steps, checking that the follower draws the host's ball; returns
 * how many steps both showed one.
 */
async function expectFollowing(host: Client, follower: Client, steps: number) {
  let shared = 0;
  for (let step = 0; step < steps; step += 1) {
    await vi.advanceTimersByTimeAsync(100);
    const hosted = host.pong.court().ball;
    const shown = follower.pong.court().ball;
    if (!hosted || !shown) continue;
    shared += 1;
    // Snapshots trail the host by up to a send interval and a paddle return.
    expect(Math.abs(shown.x - hosted.x)).toBeLessThan(25);
  }
  return shared;
}

describe('createPong', () => {
  it('runs the ball on the first seat and streams it to the second', async () => {
    fakeFrames();
    const { linked, ann, bob } = setupMatch();
    ann.match.join();
    bob.match.join();
    expect(ann.match.phase().t).toBe('playing');
    expect(bob.pong.controlledSeat()).toBe(1);

    // Bob holds his paddle at the top; the first serve heads his way.
    bob.pong.keyDown('ArrowUp');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ann.pong.court().ball).toBeDefined();
    expect(linked.presence(0)?.court?.ball).toBeDefined();
    // Snapshots survive the decoder other clients read presence through.
    expect(parseGamePresence(linked.presence(0)).court).toEqual(
      linked.presence(0)?.court
    );
    expect(bob.pong.court().ball).toBeDefined();
    // The host sees Bob's paddle move through his presence.
    expect(ann.pong.court().paddles[1]).toBeLessThan(20);

    await vi.advanceTimersByTimeAsync(3_000);
    const points = readGameLog(linked.docs[1]).filter(
      (entry) => entry.t === 'move'
    );
    expect(points.length).toBeGreaterThan(0);
    // Only the first seat records points, and both clients agree on them.
    expect(points.every((entry) => entry.by === ANN)).toBe(true);
    const phase = bob.match.phase();
    expect(phase.t === 'playing' && phase.state.scores[0]).toBeGreaterThan(0);

    // Once the match ends, no client keeps drawing a ball.
    ann.match.forfeit();
    expect(bob.match.phase().t).toBe('over');
    expect(bob.pong.court().ball).toBeUndefined();
    expect(ann.pong.court().ball).toBeUndefined();
  });

  it('follows the live host rather than a court left by a closed tab', async () => {
    fakeFrames();
    // Ann's closed tab lingers in presence: opened earlier, far ahead in
    // sequence, with a ball that never moves again.
    const { linked, clients } = setupRoom([ANN, ANN, BOB], { idle: [0] });
    const [, ann, bob] = clients;
    if (!ann || !bob) throw new Error('clients missing');
    const stale = { x: 5, y: 5, vx: 0, vy: 0 };
    linked.setPresence(0, {
      activity: 'playing',
      court: {
        round: 0,
        seq: 999_999,
        since: 0,
        points: 0,
        ball: stale,
        paddles: [30, 30],
      },
    });
    ann.match.join();
    bob.match.join();

    await vi.advanceTimersByTimeAsync(100);
    expect(ann.pong.controlledSeat()).toBe(0);
    expect(await expectFollowing(ann, bob, 40)).toBeGreaterThan(10);
  });

  it("lets one of the first seat's tabs run the ball, then hands it over", async () => {
    fakeFrames();
    const { linked, clients, close } = setupRoom([ANN, ANN, BOB]);
    const [tabA, tabB, bob] = clients;
    if (!tabA || !tabB || !bob) throw new Error('clients missing');
    tabA.match.join();
    bob.match.join();
    expect(tabB.match.mySeat()).toBe(0);

    // Both tabs opened together, so the lower presence id keeps the ball and
    // the other stops streaming a court.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tabA.pong.controlledSeat()).toBe(0);
    expect(tabB.pong.controlledSeat()).toBeUndefined();
    expect(linked.presence(1)?.court).toBeUndefined();
    expect(await expectFollowing(tabA, bob, 20)).toBeGreaterThan(5);

    // Once the running tab closes, the other takes over the same match.
    close(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(tabB.pong.controlledSeat()).toBe(0);
    expect(linked.presence(1)?.court).toBeDefined();
    expect(await expectFollowing(tabB, bob, 40)).toBeGreaterThan(10);
    const points = readGameLog(linked.docs[2]).filter(
      (entry) => entry.t === 'move'
    );
    expect(points.every((entry) => entry.by === ANN)).toBe(true);
  });

  it('leaves the ball with the tab that took over when a hidden tab returns', async () => {
    fakeFrames();
    const { linked, clients, setVisible } = setupRoom([ANN, ANN, BOB]);
    const [tabA, tabB, bob] = clients;
    if (!tabA || !tabB || !bob) throw new Error('clients missing');
    tabA.match.join();
    bob.match.join();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tabA.pong.controlledSeat()).toBe(0);
    expect(tabB.pong.controlledSeat()).toBeUndefined();

    // Tab A goes to the background, so tab B takes over the match.
    setVisible(0, false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tabB.pong.controlledSeat()).toBe(0);

    // Back in front, tab A watches tab B rather than running its stale
    // rally, so only one tab records the points.
    setVisible(0, true);
    for (let step = 0; step < 30; step += 1) {
      await vi.advanceTimersByTimeAsync(100);
      expect(tabA.pong.controlledSeat()).toBeUndefined();
      expect(linked.presence(0)?.court).toBeUndefined();
      expect(tabB.pong.controlledSeat()).toBe(0);
    }
    expect(await expectFollowing(tabB, bob, 20)).toBeGreaterThan(5);
  });

  it('leaves the ball with the running tab when a tab opened in the background is shown', async () => {
    fakeFrames();
    const { linked, clients, setVisible } = setupRoom([ANN, ANN, BOB], {
      hidden: [0],
    });
    const [tabA, tabB, bob] = clients;
    if (!tabA || !tabB || !bob) throw new Error('clients missing');
    tabB.match.join();
    bob.match.join();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tabB.pong.controlledSeat()).toBe(0);

    // Tab A opened as early as tab B and wins that tie, but it missed the
    // start of this round, so it watches tab B instead of taking over.
    setVisible(0, true);
    for (let step = 0; step < 30; step += 1) {
      await vi.advanceTimersByTimeAsync(100);
      expect(tabA.pong.controlledSeat()).toBeUndefined();
      expect(linked.presence(0)?.court).toBeUndefined();
      expect(tabB.pong.controlledSeat()).toBe(0);
    }
  });

  it('leaves the ball with the running tab after a rematch starts while a tab is hidden', async () => {
    fakeFrames();
    const { linked, clients, setVisible } = setupRoom([ANN, ANN, BOB]);
    const [tabA, tabB, bob] = clients;
    if (!tabA || !tabB || !bob) throw new Error('clients missing');
    tabA.match.join();
    bob.match.join();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tabA.pong.controlledSeat()).toBe(0);

    setVisible(0, false);
    bob.match.forfeit();
    bob.match.rematch();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tabB.pong.controlledSeat()).toBe(0);

    setVisible(0, true);
    for (let step = 0; step < 30; step += 1) {
      await vi.advanceTimersByTimeAsync(100);
      expect(tabA.pong.controlledSeat()).toBeUndefined();
      expect(linked.presence(0)?.court).toBeUndefined();
      expect(tabB.pong.controlledSeat()).toBe(0);
    }
  });

  it('resumes the ball on a lone host tab once it is shown again', async () => {
    fakeFrames();
    const { linked, clients, setVisible } = setupRoom([ANN, BOB]);
    const [ann, bob] = clients;
    if (!ann || !bob) throw new Error('clients missing');
    ann.match.join();
    bob.match.join();
    await vi.advanceTimersByTimeAsync(2_000);
    setVisible(0, false);
    await vi.advanceTimersByTimeAsync(3_000);

    // With no other tab running the ball, the watch ends and play resumes.
    setVisible(0, true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ann.pong.controlledSeat()).toBe(0);
    expect(linked.presence(0)?.court).toBeDefined();
    expect(await expectFollowing(ann, bob, 20)).toBeGreaterThan(5);
  });

  it('keeps the serve on schedule when another tab takes over after a point', async () => {
    fakeFrames();
    const { linked, clients, close } = setupRoom([ANN, ANN, BOB]);
    const [tabA, tabB, bob] = clients;
    if (!tabA || !tabB || !bob) throw new Error('clients missing');
    tabA.match.join();
    bob.match.join();
    bob.pong.keyDown('ArrowUp');
    const points = () =>
      readGameLog(linked.docs[2]).flatMap((entry) =>
        entry.t === 'move' ? [entry] : []
      );
    while (points().length === 0) await vi.advanceTimersByTimeAsync(16);
    const last = linked.presence(0)?.court;
    if (!last) throw new Error('tab A never streamed a court');
    close(0);
    // Tab A's last snapshot may predate the point and still show the ball
    // that scored, heading off the court.
    linked.setPresence(0, {
      activity: 'playing',
      court: { ...last, points: 0, ball: { x: 99, y: 30, vx: 80, vy: 0 } },
    });

    // Tab B takes over once tab A's court stops changing, before the next
    // serve is due.
    await vi.advanceTimersByTimeAsync(1_100);
    expect(tabB.pong.controlledSeat()).toBe(0);
    expect(tabB.pong.court().ball).toBeUndefined();

    // The serve comes on time, toward whoever lost the point.
    await vi.advanceTimersByTimeAsync(300);
    const scorer = (points()[0].move as { scorer: number }).scorer;
    const ball = tabB.pong.court().ball;
    expect(ball).toBeDefined();
    expect(Math.sign(ball?.vx ?? 0)).toBe(scorer === 0 ? 1 : -1);
    // The old rally was not played on, so the point counts once.
    expect(points()).toHaveLength(1);
  });

  it('plays a local practice game against the computer without writing', async () => {
    fakeFrames();
    const { linked, ann } = setupMatch();
    expect(ann.pong.canPractice()).toBe(true);
    ann.pong.startPractice();
    expect(ann.pong.controlledSeat()).toBe(0);
    // Ann never moves; the computer returns everything until someone wins.
    await vi.advanceTimersByTimeAsync(120_000);
    const practice = ann.pong.practice();
    expect(practice?.winner).toBeDefined();
    expect(Math.max(...(practice?.scores ?? [0]))).toBe(7);
    expect(readGameLog(linked.docs[0])).toEqual([]);
  });
});
