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
    const group = screen.getByRole('group', { name: 'Session start mode' });
    vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 28,
      right: 200,
      width: 200,
      height: 28,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(group, { button: 0, clientX: 20 });
    fireEvent.mouseMove(group, {
      button: 0,
      clientX: 20 + SESSION_START_TOGGLE_DRAG_THRESHOLD,
    });
    fireEvent.mouseMove(group, { button: 0, clientX: 160 });
    fireEvent.mouseUp(group, { button: 0, clientX: 160 });

    expect(onModeChange).toHaveBeenCalledWith('background');
    expect(onStart).not.toHaveBeenCalled();
  });
});
