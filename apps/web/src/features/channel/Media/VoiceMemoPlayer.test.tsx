import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceMemoPlayer } from './VoiceMemoPlayer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VoiceMemoPlayer', () => {
  it('shows the length, plays and pauses from its own button', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(async function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'));
      });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement
    ) {
      this.dispatchEvent(new Event('pause'));
    });
    let paused = true;
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
      () => paused
    );
    play.mockImplementation(async function (this: HTMLMediaElement) {
      paused = false;
      this.dispatchEvent(new Event('play'));
    });
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function (
      this: HTMLMediaElement
    ) {
      paused = true;
      this.dispatchEvent(new Event('pause'));
    });
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(
      7.4
    );

    const { container } = render(() => (
      <VoiceMemoPlayer src="https://static.test/memo" label="Voice memo" />
    ));
    const audio = container.querySelector('audio');
    if (!audio) throw new Error('no audio element');
    fireEvent(audio, new Event('loadedmetadata'));

    expect(screen.getByRole('group', { name: 'Voice memo' })).toBeTruthy();
    expect(screen.getByText('0:07')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Play voice memo' }));
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole('button', { name: 'Pause voice memo' })
    ).toBeTruthy();
    const slider = screen.getByRole('slider', {
      name: 'Position in voice memo',
    });
    // The position, not the length, even at the start.
    expect(slider.getAttribute('aria-valuetext')).toBe('0:00 of 0:07');

    fireEvent.click(screen.getByRole('button', { name: 'Pause voice memo' }));
    expect(
      await screen.findByRole('button', { name: 'Play voice memo' })
    ).toBeTruthy();
  });

  it('plays a memo of unknown length without reading it ahead', () => {
    const seeks = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(
      Number.POSITIVE_INFINITY
    );
    let position = 0;
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'get'
    ).mockImplementation(() => position);
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'set'
    ).mockImplementation(seeks);
    const { container } = render(() => (
      <VoiceMemoPlayer src="https://static.test/memo.webm" label="Voice memo" />
    ));
    const audio = container.querySelector('audio');
    if (!audio) throw new Error('no audio element');
    fireEvent(audio, new Event('loadedmetadata'));
    fireEvent(audio, new Event('durationchange'));
    expect(seeks).not.toHaveBeenCalled();

    position = 2.4;
    fireEvent(audio, new Event('timeupdate'));
    expect(screen.getByText('0:02')).toBeTruthy();
  });

  it('shows a spinner and no controls while the memo uploads', () => {
    render(() => <VoiceMemoPlayer label="Voice memo" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
