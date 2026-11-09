/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Track } from 'livekit-client';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TrackView } from '../TrackView';

afterEach(cleanup);

it('updates fit and mirroring without reattaching a mounted track', () => {
  const video = document.createElement('video');
  const attach = vi.fn(() => video);
  const detach = vi.fn(() => [video]);
  const track = { attach, detach } as unknown as Track;
  render(() => {
    const [pinned, setPinned] = createSignal(false);
    return (
      <>
        <button onClick={() => setPinned(!pinned())}>Pin</button>
        <TrackView
          track={track}
          fit={pinned() ? 'contain' : 'cover'}
          mirror={pinned()}
        />
      </>
    );
  });
  expect(video.style.objectFit).toBe('cover');
  fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
  expect(video.style.objectFit).toBe('contain');
  expect(video.style.transform).toBe('scaleX(-1)');
  expect(attach).toHaveBeenCalledTimes(1);
  expect(detach).not.toHaveBeenCalled();
  expect(video.isConnected).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
  expect(video.style.objectFit).toBe('cover');
  expect(video.style.transform).toBe('');
  cleanup();
  expect(detach).toHaveBeenCalledTimes(1);
});
