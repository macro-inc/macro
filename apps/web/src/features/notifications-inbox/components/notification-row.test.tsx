import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationRow, type NotificationRowProps } from './notification-row';

const layout = vi.hoisted(() => ({ phone: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => layout.phone }));

const setup = (overrides: Partial<NotificationRowProps> = {}) => {
  const onClick = vi.fn();
  const [unfolded, setUnfolded] = createSignal(false);
  const onToggleStack = vi.fn(() => setUnfolded((open) => !open));
  render(() => (
    <NotificationRow
      id="row"
      icon={<span />}
      who="Sam and Ana commented"
      what="Launch plan"
      body="Can we move the date?"
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

// Inert preview text is drawn once on screen and once more, visually hidden,
// for assistive technology; read the copy on screen.
const SHOWN = { ignore: '.sr-only' };

const toggle = () => screen.getByRole('button', { name: /3 notifications/ });

const separator = () => document.querySelector('[data-row-separator]');
const dot = () => screen.queryByLabelText('Unread');
const avatar = () => document.querySelector('[data-card-avatar]');

describe('NotificationRow', () => {
  afterEach(() => {
    layout.phone = false;
  });

  it('opens when chosen and leaves its stack folded', () => {
    const { onClick, onToggleStack } = setup();

    fireEvent.click(screen.getByText('Launch plan', SHOWN));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onToggleStack).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('unfolds and folds from the same button without opening', () => {
    const { onClick, onToggleStack } = setup();
    const button = toggle();

    fireEvent.click(button);
    expect(toggle()).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toBe('Hide');

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toBe('2 more');

    expect(onToggleStack).toHaveBeenCalledTimes(2);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks done from its own button without opening', () => {
    const onDone = vi.fn();
    const { onClick } = setup({ onDone });

    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));

    expect(onDone).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('unfolds and folds from its caret on a phone without opening', () => {
    layout.phone = true;
    const { onClick, onToggleStack } = setup();

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    expect(onToggleStack).toHaveBeenCalledTimes(2);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('says the same thing whether its stack is open or not', () => {
    setup();

    fireEvent.click(toggle());

    expect(screen.getByText('Sam and Ana commented', SHOWN)).toBeTruthy();
    expect(screen.getByText('Launch plan', SHOWN)).toBeTruthy();
    expect(screen.getByText('Can we move the date?', SHOWN)).toBeTruthy();
  });

  it('says only what it has to say', () => {
    render(() => (
      <NotificationRow
        id="row"
        icon={<span />}
        who="Dana assigned you a task"
        time="2m"
        count={1}
        unfolded={false}
        unseen
        highlighted={false}
        onClick={() => {}}
        onHover={() => {}}
        onDone={() => {}}
        onToggleStack={() => {}}
      />
    ));

    expect(screen.getByText('Dana assigned you a task', SHOWN)).toBeTruthy();
    expect(document.querySelector('[data-card-what]')).toBeNull();
    expect(document.querySelector('[data-card-body]')).toBeNull();
  });

  it('offers no button for a single notification', () => {
    setup({ count: 1 });
    expect(screen.queryByRole('button', { name: /notifications/ })).toBeNull();
  });

  it('separates itself from the next row unless it ends its section', () => {
    setup({ count: 1 });
    expect(separator()).not.toBeNull();
  });

  it('has no separator at the end of its section', () => {
    setup({ count: 1, endsSection: true });
    expect(separator()).toBeNull();
  });

  it('leaves the separator to its notifications while its stack is open', () => {
    setup();
    fireEvent.click(toggle());
    expect(separator()).toBeNull();
  });

  it('says how many more a folded stack holds at its bottom', () => {
    setup();
    expect(toggle().textContent).toBe('2 more');
  });

  it("keeps a phone's caret on the first line, next to the time", () => {
    layout.phone = true;
    setup();
    const time = screen.getByText('2m').closest('[data-card-time]');
    expect(time?.nextElementSibling).toBe(toggle());
    expect(toggle().textContent).toBe('');
  });

  it('marks an unread row with a dot in the gutter left of its avatar', () => {
    setup({ count: 1 });
    const gutter = dot()?.parentElement;
    expect(gutter?.nextElementSibling).toBe(avatar());
    expect(gutter?.className).toContain('absolute');
  });

  it("leaves a read row's gutter empty, with its avatar where an unread one has it", () => {
    setup({ count: 1 });
    const unreadCell = avatar()?.parentElement?.className;
    document.body.innerHTML = '';
    setup({ count: 1, unseen: false });
    expect(dot()).toBeNull();
    expect(avatar()?.parentElement?.className).toBe(unreadCell);
  });
});
