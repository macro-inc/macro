import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCopyState } from '../utils/create-copy-state';
import { ButtonGroup } from './ButtonGroup';
import { CopyButton } from './CopyButton';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('copies inside editor containers that stop native click propagation', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <div on:click={(event) => event.stopPropagation()}>
        <CopyButton aria-label="Copy code" onClick={copy} icon={<svg />} />
      </div>
    ));
    const button = screen.getByRole('button', { name: 'Copy code' });
    fireEvent.click(button);
    await Promise.resolve();
    expect(copy).toHaveBeenCalledOnce();
    expect(button.querySelector('[data-copy-feedback]')).not.toBeNull();
  });

  it('waits for success and guards pending activations without replacing content', async () => {
    let complete!: () => void;
    const copy = vi.fn(
      () => new Promise<void>((resolve) => (complete = resolve))
    );
    let forwardedRef: HTMLButtonElement | undefined;
    render(() => (
      <ButtonGroup variant="outline" size="md">
        <CopyButton
          as={ButtonGroup.Button}
          ref={(element) => (forwardedRef = element)}
          onClick={copy}
          icon={<svg data-original-icon />}
        >
          Copy
        </CopyButton>
      </ButtonGroup>
    ));
    const button = screen.getByRole('button', { name: 'Copy' });
    const original = button.querySelector('[data-original-icon]');
    expect(forwardedRef).toBe(button);
    expect(button.getAttribute('data-variant')).toBe('outline');
    expect(button.getAttribute('data-size')).toBe('md');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(copy).toHaveBeenCalledOnce();
    expect(button.querySelector('[data-copy-feedback]')).toBeNull();
    complete();
    await Promise.resolve();
    expect(button.querySelector('[data-copy-feedback]')).not.toBeNull();
    expect(button.querySelector('[data-original-icon]')).toBe(original);
    expect(button.textContent).toBe('Copy');
    await vi.advanceTimersByTimeAsync(1400);
    expect(button.querySelector('[data-copy-feedback]')).toBeNull();
  });

  it.each([() => false, () => Promise.reject(new Error('denied'))])(
    'does not signal success on a failed copy',
    async (copy) => {
      render(() => (
        <CopyButton onClick={copy} icon={<svg />}>
          Copy
        </CopyButton>
      ));
      const button = screen.getByRole('button', { name: 'Copy' });
      fireEvent.click(button);
      await Promise.resolve();
      expect(button.querySelector('[data-copy-feedback]')).toBeNull();
    }
  );

  it('preserves bound handlers and leaves text-only buttons unchanged', async () => {
    const copy = vi.fn();
    render(() => <CopyButton onClick={[copy, 'text']}>Copy</CopyButton>);
    const button = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(button);
    await Promise.resolve();
    expect(copy.mock.calls[0][0]).toBe('text');
    expect(button.querySelector('svg')).toBeNull();
  });

  it('does not activate disabled buttons', () => {
    const copy = vi.fn();
    render(() => (
      <CopyButton disabled onClick={copy}>
        Copy
      </CopyButton>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copy).not.toHaveBeenCalled();
  });
});

describe('createCopyState', () => {
  it('debounces reset from the latest successful copy', async () => {
    const { copy, copied, dispose } = createRoot((dispose) => ({
      ...createCopyState(),
      dispose,
    }));
    await copy(() => true);
    expect(copied()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await copy(() => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(copied()).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(copied()).toBe(false);
    dispose();
  });

  it.each([() => false, () => Promise.reject(new Error('denied'))])(
    'clears previous success when the next copy fails',
    async (fail) => {
      const { copy, copied, dispose } = createRoot((dispose) => ({
        ...createCopyState(),
        dispose,
      }));
      await copy(() => true);
      await copy(fail);
      expect(copied()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      dispose();
    }
  );

  it('ignores pending completion after disposal', async () => {
    let complete!: () => void;
    const { copy, copied, dispose } = createRoot((dispose) => ({
      ...createCopyState(),
      dispose,
    }));
    const pending = copy(
      () => new Promise<void>((resolve) => (complete = resolve))
    );
    dispose();
    complete();
    await pending;
    expect(copied()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
