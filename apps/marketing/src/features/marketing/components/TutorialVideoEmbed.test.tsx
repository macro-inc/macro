import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TutorialVideoEmbed } from './TutorialVideoEmbed';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../../app/utils/utilAnalytic', () => ({ analytics }));
const play = vi.fn();
beforeEach(() => {
  play.mockImplementation(function (this: HTMLVideoElement) {
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('waits for play, then hands focus and controls to the video and records playback once', () => {
  const { container } = render(() => <TutorialVideoEmbed tutorial="mail" />);
  const video = container.querySelector('video')!;
  expect(video.autoplay).toBe(false);
  expect(video.preload).toBe('none');
  expect(play).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Play Learn how/ }));
  expect(play).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(video);
  expect(video.controls).toBe(true);
  expect(screen.queryByRole('button', { name: /^Play Learn how/ })).toBeNull();
  fireEvent.playing(video);
  expect(analytics.track).toHaveBeenCalledTimes(1);
});

it('restores the play button if the browser refuses playback', async () => {
  play.mockRejectedValue(new Error('Playback refused'));
  render(() => <TutorialVideoEmbed tutorial="tasks" />);
  fireEvent.click(screen.getByRole('button', { name: /^Play Learn how/ }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Play Learn how/ })).toBeTruthy()
  );
  expect(analytics.track).not.toHaveBeenCalled();
});
