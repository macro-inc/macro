import { cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGameLog, readRaceProgress } from '../core/game-document';
import { TYPING_PASSAGES } from '../core/games/typing-race';
import { renderGameRoom } from '../tests/render-game-room';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

const ANN = 'macro|ann@macro.com';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TypingRaceRoom', () => {
  it('keeps what a racer typed while progress syncs, then submits the finish', async () => {
    vi.useFakeTimers();
    const { fake, games } = renderGameRoom({
      userId: ANN,
      kind: 'typing_race',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join race' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start race' }));
    expect(screen.getByText('Get ready… 5')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5_200);
    expect(screen.getByText('Go! Type the passage exactly.')).toBeTruthy();
    const start = readGameLog(fake.doc).find((entry) => entry.t === 'race');
    const passage =
      start?.t === 'race' ? TYPING_PASSAGES[start.passage] : undefined;
    if (!passage) throw new Error('race did not start');
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Type the passage',
    });

    fireEvent.input(box, { target: { value: passage.slice(0, 5) } });
    // Progress reaches the document, which must not clear the local text.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readRaceProgress(fake.doc, 0).get(ANN)?.typed).toBe(5);
    expect(box.value).toBe(passage.slice(0, 5));

    fireEvent.input(box, { target: { value: passage } });
    await vi.advanceTimersByTimeAsync(100);
    expect(games.scores).toHaveLength(1);
    expect(games.scores[0].kind).toBe('typing_race');
    expect(readRaceProgress(fake.doc, 0).get(ANN)?.finishedMs).toBeGreaterThan(
      0
    );
    expect(screen.getByText(/New personal best: \d+ WPM/)).toBeTruthy();
  });
});
