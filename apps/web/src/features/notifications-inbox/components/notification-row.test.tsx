import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { NotificationRow, type NotificationRowProps } from './notification-row';

const setup = (overrides: Partial<NotificationRowProps> = {}) => {
  const onClick = vi.fn();
  const [unfolded, setUnfolded] = createSignal(false);
  const onToggleStack = vi.fn(() => setUnfolded((open) => !open));
  render(() => (
    <NotificationRow
      id="row"
      icon={<span />}
      title="Launch plan"
      detail="Sam and Ana commented"
      time="2m"
      count={3}
      unfolded={unfolded()}
      unseen
      highlighted={false}
      onClick={onClick}
      onHover={() => {}}
      onDone={() => {}}
      onToggleStack={onToggleStack}
      {...overrides}
    />
  ));
  return { onClick, onToggleStack };
};

const toggle = () => screen.getByRole('button', { name: /3 notifications/ });

describe('NotificationRow', () => {
  it('opens when chosen and leaves its stack folded', () => {
    const { onClick, onToggleStack } = setup();

    fireEvent.click(screen.getByText('Launch plan'));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onToggleStack).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('unfolds and folds from its own button without opening', () => {
    const { onClick, onToggleStack } = setup();

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    expect(onToggleStack).toHaveBeenCalledTimes(2);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('offers no button for a single notification', () => {
    setup({ count: 1 });
    expect(screen.queryByRole('button', { name: /notifications/ })).toBeNull();
  });
});
