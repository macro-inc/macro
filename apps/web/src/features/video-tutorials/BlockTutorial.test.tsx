import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUTORIALS } from './catalog';
import { TutorialPill, TutorialRow } from './views/BlockTutorial';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

beforeEach(() => {
  localStorage.clear();
  track.mockClear();
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

describe('block tutorial row', () => {
  it('opens the video paused and plays it only from the play button', async () => {
    render(() => <TutorialRow tutorial="mail" />);

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

  it('counts a play once, when playback really starts', async () => {
    render(() => <TutorialRow tutorial="mail" />);

    fireEvent.click(row()!);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    const played = () =>
      track.mock.calls.filter(([, payload]) => payload.action === 'played');
    expect(played()).toHaveLength(0);

    fireEvent.play(video()!);
    fireEvent.play(video()!);
    expect(played()).toHaveLength(1);
  });

  it('closes on Escape once playing and pauses the video', async () => {
    render(() => <TutorialRow tutorial="mail" />);

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
    const first = render(() => <TutorialRow tutorial="mail" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(row()).toBeNull();
    first.unmount();

    render(() => <TutorialRow tutorial="mail" />);
    expect(row()).toBeNull();
  });
});

describe('block tutorial pill', () => {
  it('opens the same paused video and dismisses separately from other tutorials', async () => {
    render(() => <TutorialPill tutorial="mail" />);
    fireEvent.click(
      screen.getByRole('button', { name: /Learn how to use Macro Mail/ })
    );
    await screen.findByRole('dialog');
    expect(play).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('tutorial_video', {
      tutorial: 'macro-mail',
      action: 'opened',
    });
  });

  it('renders nothing for a block whose video is not in the catalog yet', () => {
    // Every block gets a video eventually, so take one out for this test.
    const scheduling = TUTORIALS.scheduling;
    delete TUTORIALS.scheduling;
    try {
      render(() => <TutorialPill tutorial="scheduling" />);
      expect(screen.queryByRole('button')).toBeNull();
    } finally {
      TUTORIALS.scheduling = scheduling;
    }
  });
});
