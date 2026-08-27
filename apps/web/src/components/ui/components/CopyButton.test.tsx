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

afterEach(cleanup);

describe('CopyButton', () => {
  it('copies text and swaps the icon for a check', async () => {
    render(() => <CopyButton text="hello" />);

    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button.getAttribute('data-copy-status')).toBe('idle');

    fireEvent.click(button);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello');
      expect(
        screen
          .getByRole('button', { name: 'Copied' })
          .getAttribute('data-copy-status')
      ).toBe('success');
    });
    expect(
      screen
        .getByRole('button', { name: 'Copied' })
        .querySelector('svg')
        ?.classList.contains('text-success')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Copied' })
        .getAttribute('data-variant')
    ).toBe('success');
  });

  it('resolves a getter at click time', async () => {
    let payload = 'first';
    render(() => <CopyButton text={() => payload} />);

    payload = 'second';
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('second');
      expect(
        screen
          .getByRole('button', { name: 'Copied' })
          .getAttribute('data-copy-status')
      ).toBe('success');
    });
  });

  it('swaps the icon for a warning when the clipboard write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeText.mockRejectedValue(new Error('denied'));
    const onCopyError = vi.fn();
    render(() => <CopyButton text="secret" onCopyError={onCopyError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Copy failed' })
          .getAttribute('data-copy-status')
      ).toBe('error');
    });
    expect(onCopyError).toHaveBeenCalledOnce();
    expect(
      screen
        .getByRole('button', { name: 'Copy failed' })
        .querySelector('svg')
        ?.classList.contains('text-failure')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Copy failed' })
        .getAttribute('data-variant')
    ).toBe('danger');
  });

  it('does not change state when the payload is empty', async () => {
    render(() => <CopyButton text={() => ''} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: 'Copy' })
        .getAttribute('data-copy-status')
    ).toBe('idle');
  });

  it('resets back to the copy icon after the timeout', async () => {
    render(() => <CopyButton text="hello" resetMs={20} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Copied' })
          .getAttribute('data-copy-status')
      ).toBe('success')
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Copy' })
          .getAttribute('data-copy-status')
      ).toBe('idle')
    );
  });

  it('uses a custom idle label', () => {
    render(() => <CopyButton text="hello" label="Copy subject" />);

    expect(screen.getByRole('button', { name: 'Copy subject' })).toBeTruthy();
  });
});
