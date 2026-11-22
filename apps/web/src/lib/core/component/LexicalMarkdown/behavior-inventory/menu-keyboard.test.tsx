import { render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMenuKeyboardNavigation } from '../component/menu/useMenuKeyboardNavigation';

const CLEANUPS: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of CLEANUPS.splice(0)) cleanup();
});

describe('inline menu keyboard navigation', () => {
  it.each([
    { key: 'ArrowUp', direction: 'up' },
    { key: 'ArrowDown', direction: 'down' },
    { key: 'ArrowLeft', direction: 'left' },
    { key: 'ArrowRight', direction: 'right' },
    { key: 'Tab', direction: 'down' },
    { key: 'Tab', shiftKey: true, direction: 'up' },
    { key: 'k', ctrlKey: true, direction: 'up' },
    { key: 'k', metaKey: true, direction: 'up' },
    { key: 'p', ctrlKey: true, direction: 'up' },
    { key: 'j', ctrlKey: true, direction: 'down' },
    { key: 'j', metaKey: true, direction: 'down' },
    { key: 'n', ctrlKey: true, direction: 'down' },
    { key: 'h', ctrlKey: true, direction: 'left' },
    { key: 'h', metaKey: true, direction: 'left' },
    { key: 'l', ctrlKey: true, direction: 'right' },
    { key: 'l', metaKey: true, direction: 'right' },
    { key: 'Enter', direction: 'select' },
    { key: 'Escape', direction: 'close' },
  ])(
    'routes $key to $direction and consumes the event ($ctrlKey, $metaKey, $shiftKey)',
    (input) => {
      const selected = vi.fn();
      const mounted = render(() => {
        useMenuKeyboardNavigation({
          onUp: () => selected('up'),
          onDown: () => selected('down'),
          onLeft: () => selected('left'),
          onRight: () => selected('right'),
          onSelect: () => selected('select'),
          onClose: () => selected('close'),
        });
        return <div />;
      });
      CLEANUPS.push(mounted.unmount);
      const event = new KeyboardEvent('keydown', {
        ...input,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      expect(selected.mock.calls).toEqual([[input.direction]]);
      expect(event.defaultPrevented).toBe(true);
    }
  );

  it.each(['n', 'p', 'j', 'k', 'h', 'l', 'x'])(
    'leaves an unmodified %s to ordinary typing',
    (key) => {
      const other = vi.fn();
      const selected = vi.fn();
      const mounted = render(() => {
        useMenuKeyboardNavigation({
          onOtherKey: other,
          onDown: selected,
          onUp: selected,
          onLeft: selected,
          onRight: selected,
        });
        return <div />;
      });
      CLEANUPS.push(mounted.unmount);
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      document.dispatchEvent(event);
      expect(other).toHaveBeenCalledOnce();
      expect(selected).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    }
  );

  it.each([true, false])(
    'space handler controls consumption: %s',
    (consume) => {
      const mounted = render(() => {
        useMenuKeyboardNavigation({ onSpace: () => consume });
        return <div />;
      });
      CLEANUPS.push(mounted.unmount);
      const event = new KeyboardEvent('keydown', {
        key: ' ',
        cancelable: true,
      });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(consume);
    }
  );

  it('does not dispatch while the menu is inactive or after disposal', () => {
    let active = false;
    const select = vi.fn();
    const mounted = render(() => {
      useMenuKeyboardNavigation({ isActive: () => active, onSelect: select });
      return <div />;
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(select).not.toHaveBeenCalled();
    active = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(select).toHaveBeenCalledOnce();
    mounted.unmount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(select).toHaveBeenCalledOnce();
  });

  it('can delegate without preventing the browser default', () => {
    const select = vi.fn();
    const mounted = render(() => {
      useMenuKeyboardNavigation({ preventDefault: false, onSelect: select });
      return <div />;
    });
    CLEANUPS.push(mounted.unmount);
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(select).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });
});
