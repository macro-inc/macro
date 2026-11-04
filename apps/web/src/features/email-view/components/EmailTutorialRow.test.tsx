import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTutorialRow } from './EmailTutorialRow';

vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

beforeEach(() => {
  localStorage.clear();
  play.mockClear();
  pause.mockClear();
  // jsdom has no media playback.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: pause,
  });
});

afterEach(cleanup);

const row = () =>
  screen.queryByRole('button', { name: /Learn how to use Macro Mail/ });
const video = () => document.querySelector('video');

describe('email tutorial row', () => {
  it('opens the video paused and plays it only from the play button', async () => {
    render(() => <EmailTutorialRow />);

    fireEvent.click(row()!);
    await screen.findByRole('dialog');
    expect(play).not.toHaveBeenCalled();
    expect(video()?.autoplay).toBe(false);
    expect(video()?.controls).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(video()?.controls).toBe(true);
    expect(document.activeElement).toBe(video());
  });

  it('closes on Escape once playing and pauses the video', async () => {
    render(() => <EmailTutorialRow />);

    fireEvent.click(row()!);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    fireEvent.keyDown(video()!, { key: 'Escape' });

    expect(pause).toHaveBeenCalled();
    // jsdom keeps Kobalte's dialog mounted for its exit; it is closed once marked so.
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog')?.hasAttribute('data-closed') ?? true
      ).toBe(true)
    );
  });

  it('stays dismissed on this device', () => {
    const first = render(() => <EmailTutorialRow />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(row()).toBeNull();
    first.unmount();

    render(() => <EmailTutorialRow />);
    expect(row()).toBeNull();
  });
});
