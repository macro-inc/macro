import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TutorialVideoDialog } from './TutorialVideoDialog';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../../app/utils/utilAnalytic', () => ({ analytics }));

const play = vi.fn();

beforeEach(() => {
  // JSDOM has no media playback; stand in for the browser starting the video.
  play.mockImplementation(function (this: HTMLVideoElement) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.play = play;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // JSDOM has no default animation-name; presence detection expects `none`.
  const styles = document.createElement('style');
  styles.textContent = '* { animation-name: none; }';
  styles.id = 'test-animation-default';
  document.head.append(styles);
});

afterEach(() => {
  cleanup();
  document.getElementById('test-animation-default')?.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const openDialog = async () => {
  const trigger = screen.getByRole('button', { name: /Watch demo/ });
  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  return trigger;
};

it('opens the video paused and plays only from the play pill', async () => {
  render(() => <TutorialVideoDialog tutorial="mail" />);
  await openDialog();

  const dialog = screen.getByRole('dialog', {
    name: 'Learn how to use Macro Mail',
  });
  const video = dialog.querySelector('video');
  expect(video?.getAttribute('src')).toBe('/video/tutorials/mail.mp4');
  expect(video?.autoplay).toBe(false);
  expect(play).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Play Learn how to use Macro Mail, 1:42',
    })
  );

  expect(play).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: /^Play Learn how/ })).toBeNull();
  expect(analytics.track).toHaveBeenCalledWith(
    'tutorial_video',
    expect.objectContaining({ tutorial: 'macro-mail', action: 'played' })
  );
});

it('closes on Escape and returns focus to Watch demo', async () => {
  render(() => <TutorialVideoDialog tutorial="tasks" />);
  const trigger = await openDialog();
  const close = screen.getByRole('button', { name: 'Close video' });
  await waitFor(() => expect(document.activeElement).toBe(close));

  fireEvent.keyDown(close, { key: 'Escape' });

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
