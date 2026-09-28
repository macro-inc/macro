import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  centeredPaddles,
  clampPaddle,
  computerPaddle,
  extrapolateBall,
  nextServe,
  PONG_PADDLE_SPEED,
  PONG_POINTS_TO_WIN,
  type PongBall,
  type PongCourtSnapshot,
  type PongPoint,
  type PongScore,
  type PongSeat,
  serveBall,
  stepPongBall,
} from '../core/games/pong';
import { createRandom, type Random, randomSeed } from '../core/random';
import { createFrameLoop } from './create-frame-loop';
import type { GameRoom } from './create-game-room';
import type { TurnMatchState } from './create-turn-match';
import { createHeldKeys, DOWN_KEYS, UP_KEYS } from './held-keys';

/** Snapshots and paddle updates go out about fifteen times a second. */
const SEND_EVERY_MS = 66;
/** A still paddle is re-sent now and then so a rejoining host picks it up. */
const RESEND_EVERY_MS = 1_000;
const SERVE_DELAY_MS = 1_200;
/** Extrapolate at most this far past the host's last update. */
const MAX_EXTRAPOLATION_MS = 300;
/**
 * A stream counts as live while it keeps changing this recently. A closed or
 * reloaded tab lingers in presence for a few seconds with its last value.
 */
const LIVE_MS = 1_000;

export type PongCourtView = {
  ball: PongBall | undefined;
  paddles: readonly [number, number];
};

type Practice = {
  scores: [number, number];
  winner: PongSeat | undefined;
};

type Stream<T> = {
  peerId: string;
  value: T;
  /** When this client saw the value change; undefined until it does. */
  changedAt: number | undefined;
};

/**
 * Remembers when each client's streamed value last changed. A value that has
 * not changed since this client first saw it may be a closed tab's last
 * update, so it has no change time.
 */
function createChangeTracker() {
  const seen = new Map<string, { value: number; at: number | undefined }>();
  return (peerId: string, value: number, t: number) => {
    const previous = seen.get(peerId);
    const at = !previous
      ? undefined
      : previous.value === value
        ? previous.at
        : t;
    seen.set(peerId, { value, at });
    return at;
  };
}

const changedAtOrNever = (changedAt: number | undefined) =>
  changedAt ?? Number.NEGATIVE_INFINITY;

/** Whether this tab is showing; a hidden tab gets no animation frames. */
function createPageVisible(): Accessor<boolean> {
  const showing = () =>
    typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const [visible, setVisible] = createSignal(showing());
  if (typeof document !== 'undefined') {
    const onVisibility = () => setVisible(showing());
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() =>
      document.removeEventListener('visibilitychange', onVisibility)
    );
  }
  return visible;
}

type HostKey = { since: number; peerId: string };

/** The first seat's longest-open tab runs the ball; ties go to the lower id. */
function outranks(a: HostKey, b: HostKey): boolean {
  return a.since !== b.since ? a.since < b.since : a.peerId < b.peerId;
}

/**
 * Real-time play for a Pong room. The first seat's client runs the ball and
 * records each point in the room log; the second seat streams its paddle;
 * everyone else draws the first seat's snapshots, extrapolated between
 * updates. If the first seat has several tabs open, the one open longest
 * runs the ball and the others watch until it stops. Alone in the lobby, a
 * player can practice against the computer.
 */
export function createPong(
  room: GameRoom,
  match: TurnMatchState<PongScore, PongPoint>,
  options: {
    random?: Random;
    now?: () => number;
    visible?: Accessor<boolean>;
  } = {}
) {
  const random = options.random ?? createRandom(randomSeed());
  const now = options.now ?? (() => performance.now());
  const visible = options.visible ?? createPageVisible();
  const keys = createHeldKeys();
  let pointer: number | undefined;
  /** Sent with each snapshot so the first seat's tabs agree on who hosts. */
  const self: HostKey = { since: Date.now(), peerId: room.peerId };

  const phase = match.phase;
  const round = () => {
    const current = phase();
    return current.t === 'lobby' ? -1 : current.round;
  };
  const playing = () => phase().t === 'playing';
  const seat = () => match.mySeat();
  /** Points played so far in the current round. */
  const pointsPlayed = () => {
    const current = phase();
    return current.t === 'lobby'
      ? 0
      : current.state.scores[0] + current.state.scores[1];
  };

  const courtChanged = createChangeTracker();
  const paddleChanged = createChangeTracker();

  /** Courts streamed by the first seat's clients for this round. */
  const hostStreams = (t: number): Stream<PongCourtSnapshot>[] => {
    const host = match.match().seats[0];
    return room.peers().flatMap((peer) => {
      const snapshot = peer.presence.court;
      if (!host || peer.userId !== host || snapshot?.round !== round())
        return [];
      return [
        {
          peerId: peer.peerId,
          value: snapshot,
          changedAt: courtChanged(peer.peerId, snapshot.seq, t),
        },
      ];
    });
  };
  const isLive = (stream: Stream<unknown>, t: number) =>
    stream.changedAt !== undefined && t - stream.changedAt <= LIVE_MS;
  const hostKey = (stream: Stream<PongCourtSnapshot>): HostKey => ({
    since: stream.value.since,
    peerId: stream.peerId,
  });

  /** The court to follow: the top-ranked live host, else the freshest. */
  const activeCourt = (t: number) => {
    const streams = hostStreams(t);
    const live = streams.filter((stream) => isLive(stream, t));
    if (live.length > 0)
      return live.reduce((best, stream) =>
        outranks(hostKey(stream), hostKey(best)) ? stream : best
      );
    return streams.reduce<Stream<PongCourtSnapshot> | undefined>(
      (best, stream) =>
        !best ||
        changedAtOrNever(stream.changedAt) > changedAtOrNever(best.changedAt)
          ? stream
          : best,
      undefined
    );
  };

  /** A longer-open tab of the first seat is running the ball. */
  const outranked = (t: number) =>
    hostStreams(t).some(
      (stream) => isLive(stream, t) && outranks(hostKey(stream), self)
    );

  /** The second seat's paddle from whichever of its clients moved last. */
  const guestPaddle = (t: number): number | undefined => {
    const guest = match.match().seats[1];
    let latest: { value: number; at: number } | undefined;
    for (const peer of room.peers()) {
      const paddle = peer.presence.paddle;
      if (!guest || peer.userId !== guest || paddle === undefined) continue;
      const at = changedAtOrNever(paddleChanged(peer.peerId, paddle, t));
      if (!latest || at > latest.at) latest = { value: paddle, at };
    }
    return latest?.value;
  };

  const [court, setCourt] = createSignal<PongCourtView>({
    ball: undefined,
    paddles: centeredPaddles(),
  });
  const [practice, setPractice] = createSignal<Practice>();
  /** This first-seat client is watching another of its tabs run the ball. */
  const [deferring, setDeferring] = createSignal(false);
  const defer = (next: boolean) => {
    if (next === deferring()) return;
    setDeferring(next);
    // Stop advertising a court this tab no longer runs.
    if (next) room.setPresence({ activity: 'playing' });
  };

  // Mutable simulation state, published to `court` once per frame.
  let own = centeredPaddles()[0];
  let other = centeredPaddles()[1];
  let ball: PongBall | undefined;
  let serveAt = 0;
  let serveToward: PongSeat = 1;
  let lastSent = Number.NEGATIVE_INFINITY;
  let sentPaddle: number | undefined;
  let seq = 0;
  /** When the current round began on this client. */
  let roundStartedAt = Number.NEGATIVE_INFINITY;
  /** When this client last ran a frame of the current round. */
  let lastFrameAt: number | undefined;
  /** A first-seat tab that rejoined only watches until then. */
  let watchUntil = Number.NEGATIVE_INFINITY;

  const resetCourt = (toward: PongSeat) => {
    own = centeredPaddles()[0];
    other = centeredPaddles()[1];
    ball = undefined;
    serveToward = toward;
    serveAt = now() + SERVE_DELAY_MS;
    setCourt({ ball: undefined, paddles: centeredPaddles() });
  };

  const moveOwnPaddle = (dtSec: number) => {
    const axis = keys.axis(UP_KEYS, DOWN_KEYS);
    if (axis !== 0) {
      pointer = undefined;
      own = clampPaddle(own + axis * PONG_PADDLE_SPEED * dtSec);
    } else if (pointer !== undefined) {
      own = clampPaddle(pointer);
    }
  };

  /** Runs the ball; returns the seat that scored, if any. */
  const runBall = (t: number, dtSec: number, paddles: [number, number]) => {
    if (!ball) {
      if (t >= serveAt) ball = serveBall(serveToward, random);
      return undefined;
    }
    const step = stepPongBall(ball, paddles, dtSec);
    ball = step.ball;
    if (step.scorer === undefined) return undefined;
    // The player who lost the point receives the next serve.
    serveToward = step.scorer === 0 ? 1 : 0;
    ball = undefined;
    serveAt = t + SERVE_DELAY_MS;
    return step.scorer;
  };

  const hostFrame = (t: number, dtSec: number) => {
    moveOwnPaddle(dtSec);
    other = guestPaddle(t) ?? other;
    const paddles: [number, number] = [own, other];
    const scorer = runBall(t, dtSec, paddles);
    if (scorer !== undefined) match.move({ scorer });
    setCourt({ ball, paddles });
    if (t - lastSent >= SEND_EVERY_MS) {
      lastSent = t;
      seq += 1;
      room.setPresence({
        activity: 'playing',
        court: {
          round: round(),
          seq,
          since: self.since,
          points: pointsPlayed(),
          ball,
          paddles,
        },
      });
    }
  };

  const followerFrame = (t: number, dtSec: number, isGuest: boolean) => {
    if (isGuest) {
      moveOwnPaddle(dtSec);
      const moved =
        sentPaddle === undefined || Math.abs(own - sentPaddle) > 0.05;
      if (
        (moved && t - lastSent >= SEND_EVERY_MS) ||
        t - lastSent >= RESEND_EVERY_MS
      ) {
        lastSent = t;
        sentPaddle = own;
        room.setPresence({ activity: 'playing', paddle: own });
      }
    }
    const stream = activeCourt(t);
    if (!stream) {
      setCourt({
        ball: undefined,
        paddles: isGuest ? [centeredPaddles()[0], own] : centeredPaddles(),
      });
      return;
    }
    const snapshot = stream.value;
    const age =
      stream.changedAt === undefined
        ? 0
        : Math.min(MAX_EXTRAPOLATION_MS, t - stream.changedAt) / 1000;
    // A snapshot from before the latest point still shows the ball that
    // scored; that rally is over.
    const rallyOver = snapshot.points < pointsPlayed();
    setCourt({
      ball:
        snapshot.ball && !rallyOver
          ? extrapolateBall(snapshot.ball, age)
          : undefined,
      paddles: isGuest ? [snapshot.paddles[0], own] : snapshot.paddles,
    });
  };

  const practiceFrame = (t: number, dtSec: number) => {
    const current = practice();
    if (!current || current.winner !== undefined) return;
    moveOwnPaddle(dtSec);
    other = computerPaddle(other, ball, dtSec);
    const paddles: [number, number] = [own, other];
    const scorer = runBall(t, dtSec, paddles);
    setCourt({ ball, paddles });
    if (scorer === undefined) return;
    const scores: [number, number] = [...current.scores];
    scores[scorer] += 1;
    const won = scores.findIndex((score) => score >= PONG_POINTS_TO_WIN);
    setPractice({
      scores,
      winner: won === 0 || won === 1 ? won : undefined,
    });
  };

  const practicing = () => {
    const current = practice();
    return !!current && current.winner === undefined && !playing();
  };

  createFrameLoop({
    running: () => visible() && (playing() || practicing()),
    onFrame: (dtMs, t) => {
      const dtSec = dtMs / 1000;
      if (!playing()) {
        practiceFrame(t, dtSec);
        return;
      }
      // A hidden or sleeping tab gets no frames, so another of the first
      // seat's tabs may have taken over the ball. A tab that missed part of
      // the round ranks as the newest and watches for a running tab before
      // it may run the ball.
      const away =
        lastFrameAt === undefined
          ? t - roundStartedAt > LIVE_MS
          : t - lastFrameAt > LIVE_MS;
      if (away) {
        self.since = Date.now();
        watchUntil = t + LIVE_MS;
      }
      lastFrameAt = t;
      const mine = seat();
      const behind = mine === 0 && outranked(t);
      defer(mine === 0 && (behind || t < watchUntil));
      if (mine === 0 && !deferring()) {
        hostFrame(t, dtSec);
        return;
      }
      followerFrame(t, dtSec, mine === 1);
      if (behind) {
        // Keep up with the running tab so a takeover continues its rally.
        const view = court();
        ball = view.ball;
        [own, other] = view.paddles;
      }
    },
  });

  // Each round starts from a clean court, serving to alternate sides; the
  // simulation state is imperative, so it is reset from an effect.
  const roundKey = createMemo(() => (playing() ? round() : undefined));
  createEffect(
    on(roundKey, (key) => {
      if (key === undefined) return;
      // The loop stops between rounds; only time into this round counts.
      roundStartedAt = now();
      lastFrameAt = undefined;
      setPractice(undefined);
      resetCourt(key % 2 === 0 ? 1 : 0);
    })
  );

  // Every client schedules the next serve from the log, so a tab that takes
  // over the ball serves when and where the running tab would have.
  const pointKey = createMemo(() => {
    const current = phase();
    if (current.t !== 'playing') return undefined;
    const [left, right] = current.state.scores;
    return `${current.round}:${left + right}`;
  });
  createEffect(
    on(pointKey, (key) => {
      const current = phase();
      if (key === undefined || current.t !== 'playing') return;
      ball = undefined;
      serveToward = nextServe(current.state, current.round);
      serveAt = now() + SERVE_DELAY_MS;
    })
  );

  return {
    /** The court to draw; the ball only shows while a game is running. */
    court: (): PongCourtView => {
      const view = court();
      return playing() || practice() ? view : { ...view, ball: undefined };
    },
    practice,
    /** Practice is local, so anyone can play it while no match runs. */
    canPractice: () => !playing(),
    startPractice: () => {
      if (playing()) return;
      setPractice({ scores: [0, 0], winner: undefined });
      resetCourt(1);
    },
    stopPractice: () => {
      setPractice(undefined);
      resetCourt(1);
    },
    /** Which paddle this client moves, if any. */
    controlledSeat: (): PongSeat | undefined => {
      if (practicing() || practice()?.winner !== undefined) return 0;
      const mine = seat();
      if (!playing() || (mine === 0 && deferring())) return undefined;
      return mine === 0 || mine === 1 ? mine : undefined;
    },
    pointer: (y: number) => {
      pointer = y;
    },
    keyDown: (key: string) => keys.press(key),
    keyUp: (key: string) => keys.release(key),
    blur: () => keys.clear(),
  };
}

export type PongState = ReturnType<typeof createPong>;
