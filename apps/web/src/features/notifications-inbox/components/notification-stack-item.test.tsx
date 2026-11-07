import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationStackItem,
  type NotificationStackItemProps,
} from './notification-stack-item';

const layout = vi.hoisted(() => ({ phone: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => layout.phone }));

const setup = (overrides: Partial<NotificationStackItemProps> = {}) => {
  const onClick = vi.fn();
  const onToggleStack = vi.fn();
  render(() => (
    <NotificationStackItem
      id="item"
      icon={<span data-avatar="" />}
      by="Sam"
      text="Can we move the date?"
      time="2m"
      last={false}
      count={3}
      more={0}
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

const separator = () =>
  document.querySelector<HTMLElement>('[data-row-separator]');
const hide = () => screen.queryByRole('button', { name: /3 notifications/ });

describe('NotificationStackItem', () => {
  afterEach(() => {
    layout.phone = false;
  });

  it('separates itself from the next notification from its own text', () => {
    setup();
    expect(separator()?.className).toContain('left-[84px]');
    expect(hide()).toBeNull();
  });

  it('ends its stack with Hide, which folds it without opening', () => {
    const { onClick, onToggleStack } = setup({ last: true });

    expect(hide()?.textContent).toBe('Hide');
    expect(hide()?.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(hide()!);

    expect(onToggleStack).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    expect(separator()?.className).toContain('left-[60px]');
  });

  it('leaves Hide to the caret on a phone', () => {
    layout.phone = true;
    setup({ last: true });
    expect(hide()).toBeNull();
  });

  it('has no separator when its stack ends the section', () => {
    setup({ last: true, endsSection: true });
    expect(separator()).toBeNull();
  });

  it('puts an unread notification\'s dot just left of its own avatar', () => {
    setup();
    const gutter = screen.getByLabelText('Unread').parentElement;
    const avatar = document.querySelector('[data-avatar]');
    expect(gutter?.nextElementSibling?.contains(avatar)).toBe(true);
    // Ends where the indent does, at the avatar.
    expect(gutter?.className).toContain('left-12');
    expect(gutter?.className).toContain('w-3');
  });

  it('has no dot once its stack is read', () => {
    setup({ unseen: false });
    expect(screen.queryByLabelText('Unread')).toBeNull();
  });
});
