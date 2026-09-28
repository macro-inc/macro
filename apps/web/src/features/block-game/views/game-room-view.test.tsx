import { cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameKind } from '../core/catalog';
import { appendGameLog, readGameMeta } from '../core/game-document';
import { renderGameRoom, TEST_ROOM_ID } from '../tests/render-game-room';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

const ANN = 'macro|ann@macro.com';
const BOB = 'macro|bob@macro.com';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderRoom = (
  options: { canEdit?: boolean; ready?: boolean; kind?: GameKind } = {}
) => renderGameRoom({ userId: ANN, ...options });

const cell = (row: number, column: number) =>
  screen.getByRole('button', {
    name: new RegExp(`^Row ${row}, column ${column}`),
  });

describe('GameRoomView', () => {
  it('lets an editor pick a game for a room that has none', () => {
    const { fake } = renderRoom({ ready: false });
    expect(screen.getByText('Loading game…')).toBeTruthy();

    fake.setReady(true);
    expect(screen.getByText('Pick a game for this room.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tic-Tac-Toe' }));

    expect(readGameMeta(fake.doc).kind).toBe('tic_tac_toe');
    expect(screen.getByRole('heading', { name: 'Tic-Tac-Toe' })).toBeTruthy();
    expect(screen.getByText('Take a seat to start a game.')).toBeTruthy();
  });

  it('asks viewers to wait for an editor instead of offering games', () => {
    renderRoom({ canEdit: false });
    expect(
      screen.getByText('This room has no game yet. Ask an editor to pick one.')
    ).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('plays a round against a remote player, then publishes and reports it', async () => {
    vi.useFakeTimers();
    const { fake, games } = renderRoom({ kind: 'tic_tac_toe' });

    fireEvent.click(screen.getByRole('button', { name: 'Join game' }));
    expect(
      screen.getByText(
        'Waiting for an opponent. Share this game so someone can join.'
      )
    ).toBeTruthy();
    // Bob plays from another client; his actions arrive through the document.
    appendGameLog(fake.doc, { t: 'join', by: BOB });
    expect(screen.getByText('Your turn')).toBeTruthy();

    fireEvent.click(cell(1, 1));
    expect(screen.getByText("bob's turn")).toBeTruthy();
    expect((cell(2, 1) as HTMLButtonElement).disabled).toBe(true);
    appendGameLog(fake.doc, { t: 'move', by: BOB, move: { cell: 3 } });
    fireEvent.click(cell(1, 2));
    appendGameLog(fake.doc, { t: 'move', by: BOB, move: { cell: 4 } });
    fireEvent.click(cell(1, 3));

    expect(screen.getByText('You win! 🎉')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rematch' })).toBeTruthy();
    expect(screen.getByText('1 round played')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(games.statuses.at(-1)).toEqual({
      documentId: TEST_ROOM_ID,
      status: 'finished',
    });
    expect(games.rounds).toEqual([
      {
        documentId: TEST_ROOM_ID,
        kind: 'tic_tac_toe',
        round: 0,
        winner: ANN,
        players: [ANN, BOB],
      },
    ]);
  });
});
