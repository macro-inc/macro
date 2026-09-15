import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PillTabs } from './PillTabs';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 200, height: 40 }),
}));

let drawerStyles: HTMLStyleElement;
beforeEach(() => {
  // Supply browser motion defaults missing in jsdom for Corvu's presence tracking.
  drawerStyles = document.createElement('style');
  drawerStyles.textContent =
    '[data-corvu-drawer-content], [data-corvu-drawer-overlay] { transition-duration: 0s; animation-name: none; }';
  document.head.append(drawerStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.matches('button') && this.childNodes.length === 0 ? 40 : 100;
    }
  );
});
afterEach(() => {
  cleanup();
  drawerStyles.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const [value, setValue] = createSignal('all');
  const onChange = vi.fn(setValue);
  render(() => (
    <PillTabs
      items={[
        { value: 'all', label: 'All' },
        { value: 'files', label: 'Files' },
        {
          value: 'shared',
          label: (
            <span>
              Shared <span>files</span>
            </span>
          ),
        },
        {
          value: 'notifications',
          label: <svg />,
          iconOnly: true,
          ariaLabel: 'Notifications',
        },
      ]}
      value={value()}
      onChange={onChange}
    />
  ));
  const trigger = await screen.findByRole('button', { name: 'More tabs' });
  return { trigger, value, onChange };
}

describe('pill overflow drawer', () => {
  it.each([
    ['Files', 'files'],
    ['Shared files', 'shared'],
    ['Notifications', 'notifications'],
  ])(
    'names the overflow tab "%s" and closes on selection',
    async (name, selectedValue) => {
      const { trigger, value, onChange } = await setup();
      fireEvent.pointerDown(trigger);
      fireEvent.touchMove(trigger, { touches: [{ clientX: 10, clientY: 10 }] });
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.touchEnd(trigger);
      fireEvent.click(trigger);
      const drawer = screen.getByRole('dialog', { name: 'More tabs' });
      fireEvent.click(within(drawer).getByRole('button', { name }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(selectedValue);
      expect(value()).toBe(selectedValue);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('button', { name, pressed: true })).toBeTruthy();
      fireEvent.click(trigger, { detail: 0 });
      expect(
        within(screen.getByRole('dialog')).queryByRole('button', {
          name,
        })
      ).toBeNull();
    }
  );

  it('ignores cancelled gestures and dismisses keyboard-opened drawers without selecting', async () => {
    const { trigger, onChange } = await setup();
    fireEvent.pointerDown(trigger);
    fireEvent.pointerCancel(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger, { detail: 0 });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });
});
