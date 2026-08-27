import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
});

describe('CopyButton', () => {
  it('copies text and replaces the copy icon with a check on success', async () => {
    render(() => <CopyButton text="hello world" />);

    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button.getAttribute('data-copy-status')).toBe('idle');

    fireEvent.click(button);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello world');
      expect(
        screen
          .getByRole('button', { name: 'Copied' })
          .getAttribute('data-copy-status')
      ).toBe('success');
    });
  });

  it('replaces the copy icon with a warning when clipboard access fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeText.mockRejectedValue(new Error('clipboard unavailable'));
    render(() => <CopyButton text="hello world" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: "Couldn't copy" })
          .getAttribute('data-copy-status')
      ).toBe('failure');
    });
  });

  it('treats a rejecting onCopy handler as failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(() => (
      <CopyButton
        onCopy={async () => {
          throw new Error('rich copy failed');
        }}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: "Couldn't copy" })
          .getAttribute('data-copy-status')
      ).toBe('failure');
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('restores the copy icon after the feedback timeout', async () => {
    render(() => <CopyButton text="hello world" feedbackDuration={30} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Copy' })
          .getAttribute('data-copy-status')
      ).toBe('idle');
    });
  });
});
