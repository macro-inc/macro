import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldButton } from './HoldButton';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HoldButton', () => {
  it('confirms only after the press lasts the full duration', () => {
    const onConfirm = vi.fn();
    render(() => (
      <HoldButton duration={5000} onConfirm={onConfirm}>
        Hold to delete
      </HoldButton>
    ));
    const button = screen.getByRole('button', { name: 'Hold to delete' });

    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(4999);
    expect(onConfirm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('does not confirm when released early or when the pointer leaves', () => {
    const onConfirm = vi.fn();
    render(() => (
      <HoldButton duration={5000} onConfirm={onConfirm}>
        Hold to delete
      </HoldButton>
    ));
    const button = screen.getByRole('button', { name: 'Hold to delete' });

    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(4000);
    fireEvent.pointerUp(button);
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(4000);
    fireEvent.pointerLeave(button);
    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not confirm on a click', () => {
    const onConfirm = vi.fn();
    render(() => (
      <HoldButton duration={5000} onConfirm={onConfirm}>
        Hold to delete
      </HoldButton>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Hold to delete' }));
    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms when Space is held and not when it is released early', () => {
    const onConfirm = vi.fn();
    render(() => (
      <HoldButton duration={5000} onConfirm={onConfirm}>
        Hold to delete
      </HoldButton>
    ));
    const button = screen.getByRole('button', { name: 'Hold to delete' });

    fireEvent.keyDown(button, { key: ' ' });
    vi.advanceTimersByTime(3000);
    fireEvent.keyUp(button, { key: ' ' });
    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: ' ', repeat: true });
    vi.advanceTimersByTime(5000);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('ignores presses while disabled', () => {
    const onConfirm = vi.fn();
    render(() => (
      <HoldButton duration={5000} onConfirm={onConfirm} disabled>
        Hold to delete
      </HoldButton>
    ));

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Hold to delete' })
    );
    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
