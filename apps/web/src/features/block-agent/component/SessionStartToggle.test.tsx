import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SessionStartToggle } from './SessionStartToggle';
import { SESSION_START_TOGGLE_DRAG_THRESHOLD } from './session-start-mode';

describe('SessionStartToggle', () => {
  it('starts the selected mode from the arrow and toggles from the other side', () => {
    const onModeChange = vi.fn();
    const onStart = vi.fn();
    render(() => (
      <SessionStartToggle
        mode="live"
        onModeChange={onModeChange}
        onStart={onStart}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onModeChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    expect(onModeChange).toHaveBeenCalledWith('background');
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('starts in background when that mode is already selected', () => {
    const onModeChange = vi.fn();
    const onStart = vi.fn();
    render(() => (
      <SessionStartToggle
        mode="background"
        onModeChange={onModeChange}
        onStart={onStart}
      />
    ));

    fireEvent.click(
      screen.getByRole('button', { name: 'Start session in background' })
    );
    expect(onStart).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(onModeChange).toHaveBeenCalledWith('live');
  });

  it('drags across the midpoint to switch modes without starting', () => {
    const onModeChange = vi.fn();
    const onStart = vi.fn();
    render(() => (
      <SessionStartToggle
        mode="live"
        onModeChange={onModeChange}
        onStart={onStart}
      />
    ));
    const track = screen
      .getByRole('group', {
        name: 'Session start mode',
      })
      .querySelector('[data-session-start-switch]');
    expect(track).toBeInstanceOf(HTMLElement);
    vi.spyOn(track as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 28,
      right: 48,
      width: 48,
      height: 28,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(track as HTMLElement, { button: 0, clientX: 8 });
    fireEvent.mouseMove(track as HTMLElement, {
      button: 0,
      clientX: 8 + SESSION_START_TOGGLE_DRAG_THRESHOLD,
    });
    fireEvent.mouseMove(track as HTMLElement, { button: 0, clientX: 40 });
    fireEvent.mouseUp(track as HTMLElement, { button: 0, clientX: 40 });

    expect(onModeChange).toHaveBeenCalledWith('background');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('keeps Live and Background outside a compact iOS switch', () => {
    render(() => (
      <SessionStartToggle
        mode="live"
        onModeChange={vi.fn()}
        onStart={vi.fn()}
      />
    ));
    const track = screen
      .getByRole('group', { name: 'Session start mode' })
      .querySelector('[data-session-start-switch]');
    expect(track?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['w-12', 'h-7', 'rounded-full'])
    );
    expect(track?.textContent).not.toContain('Live');
    expect(track?.textContent).not.toContain('Background');
    expect(screen.getByRole('button', { name: 'Live' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Background' })).toBeTruthy();
  });

  it('toggles from a click on the empty side of the switch', () => {
    const onModeChange = vi.fn();
    const onStart = vi.fn();
    render(() => (
      <SessionStartToggle
        mode="live"
        onModeChange={onModeChange}
        onStart={onStart}
      />
    ));
    const track = screen
      .getByRole('group', { name: 'Session start mode' })
      .querySelector('[data-session-start-switch]') as HTMLElement;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 28,
      right: 48,
      width: 48,
      height: 28,
      toJSON: () => ({}),
    });

    fireEvent.click(track, { button: 0, clientX: 40 });
    expect(onModeChange).toHaveBeenCalledWith('background');
    expect(onStart).not.toHaveBeenCalled();
  });
});
