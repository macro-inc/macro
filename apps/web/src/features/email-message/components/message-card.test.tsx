import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageCard } from './message-card';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
  ComposerSurface: (await import('@ui/components/ComposerSurface'))
    .ComposerSurface,
}));

afterEach(cleanup);

describe('MessageCard', () => {
  it.each([false, true])(
    'preserves the interactive card root and selection behavior with touch=%s',
    (touch) => {
      device.touch = touch;
      const [selected, setSelected] = createSignal(false);
      const activate = vi.fn();
      const focus = vi.fn();
      const select = vi.fn(() => setSelected(true));
      const { container } = render(() => (
        <MessageCard
          messageId="message-1"
          isSelected={selected()}
          allowHover
          isTouch={touch}
          onSelect={select}
          onActivate={activate}
          onFocus={focus}
        >
          <button data-button type="button">
            Reply
          </button>
        </MessageCard>
      ));
      const card = container.querySelector<HTMLDivElement>(
        '[data-message-body-id="message-1"]'
      )!;
      expect(card.classList.contains('bg-composer')).toBe(!touch);
      expect(card.classList.contains('bg-message')).toBe(touch);
      expect(
        container.querySelector('[data-layer], [data-surface]')
      ).toBeNull();
      const reply = screen.getByRole('button', { name: 'Reply' });
      expect(reply.parentElement).toBe(card);

      fireEvent.click(reply);

      expect(select).toHaveBeenCalledTimes(1);
      expect(activate).not.toHaveBeenCalled();
      expect(container.querySelector('[data-message-body-id]')).toBe(card);
      card.focus();
      expect(focus).toHaveBeenCalledWith(card);
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(activate).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(card);
    }
  );
});
