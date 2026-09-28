import { cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGameLog } from '../core/game-document';
import { renderGameRoom, TEST_ROOM_ID } from '../tests/render-game-room';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

const ANN = 'macro|ann@macro.com';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Start a Snake run on a known board and leave it to hit the wall. */
async function playSnake(seed: number) {
  vi.useFakeTimers();
  // Boards come from one random seed; pin it so the run is reproducible.
  vi.spyOn(Math, 'random').mockReturnValue((seed + 0.5) / 2 ** 32);
  const rendered = renderGameRoom({ userId: ANN, kind: 'snake' });
  expect(screen.getByText('Finished runs show up here.')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await vi.advanceTimersByTimeAsync(500);
  expect(rendered.fake.presence.at(-1)).toMatchObject({ activity: 'playing' });
  expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

  // Heading straight on, the snake reaches the wall within twenty steps.
  await vi.advanceTimersByTimeAsync(10_000);
  const runs = readGameLog(rendered.fake.doc).flatMap((entry) =>
    entry.t === 'run' ? [entry] : []
  );
  expect(runs).toHaveLength(1);
  expect(runs[0].by).toBe(ANN);
  return { ...rendered, score: runs[0].score };
}

describe('solo rooms', () => {
  it('records a scoring Snake run in the room and on the leaderboard', async () => {
    // This board has an apple straight ahead of the snake.
    const { fake, games, score } = await playSnake(6);
    expect(score).toBe(10);
    expect(games.scores).toEqual([{ kind: 'snake', score: 10 }]);
    expect(screen.getByText('New personal best: 10 🎉')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New game' })).toBeTruthy();
    expect(fake.presence.at(-1)).toEqual({ activity: 'watching' });
    expect(games.statuses.at(-1)).toEqual({
      documentId: TEST_ROOM_ID,
      status: 'finished',
    });
  });

  it('keeps a run that never scored out of the leaderboard', async () => {
    const { games, score } = await playSnake(1);
    expect(score).toBe(0);
    expect(games.scores).toEqual([]);
    expect(screen.getByText('Game over. 0 points · 0 apples')).toBeTruthy();
  });
});
