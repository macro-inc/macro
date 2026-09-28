import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { readGameLog, readGameMeta } from '../core/game-document';
import { ticTacToeRules } from '../core/games/tic-tac-toe';
import { createFakeRoomSource } from '../tests/fake-room-source';
import { createGameRoom } from './create-game-room';
import { createTurnMatch } from './create-turn-match';

const ANN = 'macro|ann@macro.com';
const BOB = 'macro|bob@macro.com';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

function setup(options: { canEdit?: boolean; userId?: string } = {}) {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const fake = createFakeRoomSource();
    const [canEdit, setCanEdit] = createSignal(options.canEdit ?? true);
    const [userId, setUserId] = createSignal<string | undefined>(
      options.userId ?? ANN
    );
    const room = createGameRoom({
      source: fake.source,
      userId,
      canEdit,
      requestedKind: () => 'tic_tac_toe',
    });
    return { fake, room, setCanEdit, setUserId };
  });
}

describe('createGameRoom', () => {
  it('records the requested game once an editor can write', async () => {
    const { fake, room } = setup();
    await Promise.resolve();
    expect(readGameMeta(fake.doc).kind).toBe('tic_tac_toe');
    expect(room.kind()).toBe('tic_tac_toe');
  });

  it('never writes for viewers', async () => {
    const { fake, room } = setup({ canEdit: false });
    await Promise.resolve();
    expect(readGameMeta(fake.doc).kind).toBeUndefined();
    expect(room.append({ t: 'join' })).toBe(false);
    expect(readGameLog(fake.doc)).toEqual([]);
  });

  it('stamps actions with the current user and reflects remote changes', () => {
    const { fake, room, setUserId } = setup();
    room.append({ t: 'join' });
    expect(room.log()).toEqual([{ t: 'join', by: ANN }]);
    setUserId(BOB);
    room.append({ t: 'join' });
    expect(readGameLog(fake.doc).map((entry) => entry.by)).toEqual([ANN, BOB]);
  });
});

describe('createTurnMatch', () => {
  it('only appends legal moves by the player to move', () => {
    const { fake, room, setUserId } = setup();
    const match = createRoot(() => createTurnMatch(room, ticTacToeRules));
    match.join();
    setUserId(BOB);
    match.join();
    expect(match.phase().t).toBe('playing');

    // Bob is seat 1; Ann moves first in round 0.
    expect(match.canMove()).toBe(false);
    expect(match.move({ cell: 4 })).toBe(false);
    setUserId(ANN);
    expect(match.move({ cell: 4 })).toBe(true);
    expect(match.move({ cell: 5 })).toBe(false);
    setUserId(BOB);
    expect(match.move({ cell: 4 })).toBe(false);
    expect(readGameLog(fake.doc).filter((e) => e.t === 'move')).toHaveLength(1);
  });

  it('exposes lobby actions by seat', () => {
    const { room, setUserId } = setup();
    const match = createRoot(() => createTurnMatch(room, ticTacToeRules));
    expect(match.canJoin()).toBe(true);
    match.join();
    expect(match.canJoin()).toBe(false);
    expect(match.canLeave()).toBe(true);
    expect(match.canStart()).toBe(false);
    setUserId(BOB);
    expect(match.canJoin()).toBe(true);
    expect(match.status()).toBe('waiting');
  });
});
