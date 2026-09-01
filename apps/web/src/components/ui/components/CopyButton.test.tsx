import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  afterEach(cleanup);

  it('shows a check mark after a successful copy', async () => {
    const copy = vi.fn().mockResolvedValue(true);
    render(() => <CopyButton copy={copy} label="Copy snippet" />);

    const button = screen.getByRole('button', { name: 'Copy snippet' });
    expect(button.dataset.copyStatus).toBe('idle');

    fireEvent.click(button);

    await waitFor(() => {
      expect(copy).toHaveBeenCalledOnce();
      expect(button.dataset.copyStatus).toBe('success');
      expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    });
  });

  it('shows a warning after a failed copy', async () => {
    const copy = vi.fn().mockResolvedValue(false);
    render(() => <CopyButton copy={copy} label="Copy snippet" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy snippet' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: "Couldn't copy" }).dataset.copyStatus
      ).toBe('failure');
    });
  });

  it('shows a warning when the copy function throws', async () => {
    const copy = vi.fn().mockRejectedValue(new Error('denied'));
    render(() => <CopyButton copy={copy} label="Copy snippet" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy snippet' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: "Couldn't copy" }).dataset.copyStatus
      ).toBe('failure');
    });
  });

  it('resets back to the copy icon after the timeout', async () => {
    const copy = vi.fn().mockResolvedValue(true);
    render(() => <CopyButton copy={copy} label="Copy snippet" resetMs={40} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy snippet' }));
    await waitFor(() => {
      expect(screen.getByRole('button').dataset.copyStatus).toBe('success');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy snippet' })).toBeTruthy();
      expect(screen.getByRole('button').dataset.copyStatus).toBe('idle');
    });
  });

  it('renders labeled copy / copied / failure text', async () => {
    const copy = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    render(() => <CopyButton copy={copy} labeled />);

    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button.textContent).toContain('Copy');

    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toContain('Copied'));

    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toContain("Couldn't copy"));
  });

  it('starts a provided copy function on the same click turn', () => {
    let started = false;
    render(() => (
      <CopyButton
        copy={() => {
          started = true;
        }}
        label="Copy snippet"
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy snippet' }));
    expect(started).toBe(true);
  });

  it('notifies onCopied with the outcome', async () => {
    const onCopied = vi.fn();
    render(() => (
      <CopyButton copy={() => false} label="Copy snippet" onCopied={onCopied} />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy snippet' }));

    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(false));
  });
});
