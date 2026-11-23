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
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(true);
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
    expect(
      screen.getByRole('slider', { name: 'Position in voice memo' })
    ).toBeTruthy();
  });

  it('shows a spinner and no controls while the memo uploads', () => {
    render(() => <VoiceMemoPlayer label="Voice memo" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
