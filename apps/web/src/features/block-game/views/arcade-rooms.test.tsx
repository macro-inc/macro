import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamesProvider } from '../context/games-context';
import { GAME_CATALOG } from '../core/catalog';
import { renderGameRoom } from '../tests/render-game-room';
import { createTestGamesContext } from '../tests/test-games-context';
import { GamesHubView } from './games-hub-view';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

const ANN = 'macro|ann@macro.com';

afterEach(() => {
  cleanup();
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

const message = () => document.querySelector('p[aria-live]')?.textContent;

describe('arcade rooms', () => {
  it('launches Brick Breaker and pauses when the board loses focus', async () => {
    fakeFrames();
    renderGameRoom({ userId: ANN, kind: 'brick_breaker' });
    expect(message()).toBe('Click or press Space to launch.');

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(message()).toBe('0 points · Level 1 · 3 balls left');

    fireEvent.blur(screen.getByRole('application'));
    expect(message()).toMatch(/^Paused\. /);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(message()).not.toMatch(/^Paused/);
  });

  it('starts Falling Blocks from the keyboard', () => {
    renderGameRoom({ userId: ANN, kind: 'falling_blocks' });
    expect(message()).toBe('Press an arrow key or Space to start.');
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowLeft' });
    expect(message()).toBe('0 points · 0 lines');
    fireEvent.keyDown(screen.getByRole('application'), { key: ' ' });
    expect(message()).toMatch(/^\d+ points · 0 lines$/);
  });

  it('starts Invaders and Flappy with Space', () => {
    renderGameRoom({ userId: ANN, kind: 'invaders' });
    fireEvent.keyDown(screen.getByRole('application'), { key: ' ' });
    expect(message()).toBe('0 points · Wave 1 · 3 lives');
    cleanup();

    renderGameRoom({ userId: ANN, kind: 'flappy' });
    expect(message()).toBe('Click, tap, or press Space to flap.');
    fireEvent.keyDown(screen.getByRole('application'), { key: ' ' });
    expect(message()).toBe('0 points');
  });

  it('offers Pong practice against the computer in the lobby', () => {
    renderGameRoom({ userId: ANN, kind: 'pong' });
    expect(
      screen.getByRole('img', { name: 'Pong court, 0 to 0' })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Practice vs computer' })
    );
    expect(screen.getByRole('button', { name: 'Stop practice' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop practice' }));
    expect(
      screen.getByRole('button', { name: 'Practice vs computer' })
    ).toBeTruthy();
  });
});

describe('GamesHubView', () => {
  it('groups games people play together apart from solo games', () => {
    const games = createTestGamesContext({ userId: ANN });
    render(() => (
      <GamesProvider value={games.context}>
        <GamesHubView creating={undefined} onCreate={() => {}} />
      </GamesProvider>
    ));
    const sections = [...document.querySelectorAll('section')].map(
      (section) => ({
        title: section.querySelector('h2')?.textContent,
        games: [...section.querySelectorAll('h3')].map((h) => h.textContent),
      })
    );
    expect(sections[0]).toEqual({
      title: 'Play together',
      games: [
        GAME_CATALOG.pong.title,
        GAME_CATALOG.tic_tac_toe.title,
        GAME_CATALOG.connect_four.title,
        GAME_CATALOG.dots_and_boxes.title,
        GAME_CATALOG.typing_race.title,
      ],
    });
    expect(sections[1].title).toBe('Solo');
    expect(sections[1].games[0]).toBe(GAME_CATALOG.brick_breaker.title);
  });
});
