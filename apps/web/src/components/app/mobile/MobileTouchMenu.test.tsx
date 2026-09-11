import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileTouchMenu } from './MobileTouchMenu';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 240, height: 160 }),
}));
afterEach(cleanup);
function setup(openOnRelease = true) {
  render(() => (
    <MobileTouchMenu>
      <MobileTouchMenu.Trigger
        icon={() => <svg />}
        ariaLabel="More views"
        openOnRelease={openOnRelease}
      />
      <MobileTouchMenu.Content>Menu contents</MobileTouchMenu.Content>
    </MobileTouchMenu>
  ));
  const trigger = screen.getByRole('button', { name: 'More views' });
  const press = () => {
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(event, { pointerType: 'touch', isPrimary: true, button: 0 });
    fireEvent(trigger, event);
    return event;
  };
  return { trigger, press };
}
describe('mobile menu trigger timing', () => {
  it('waits for release before opening so the held finger cannot manipulate the sheet', () => {
    const { trigger, press } = setup();
    expect(press().defaultPrevented).toBe(false);
    fireEvent.touchMove(trigger, { touches: [{ clientX: 10, clientY: 10 }] });
    expect(screen.queryByText('Menu contents')).toBeNull();
    fireEvent.touchEnd(trigger);
    fireEvent.click(trigger, { detail: 1 });
    expect(
      document
        .querySelector('.mobile-touch-menu-content')
        ?.hasAttribute('data-expanded')
    ).toBe(true);
  });
  it('does not open when a touch is cancelled instead of clicked', () => {
    const { trigger, press } = setup();
    press();
    fireEvent.pointerCancel(trigger);
    expect(screen.queryByText('Menu contents')).toBeNull();
  });
  it('preserves press-to-open for other touch menus without toggling on the release click', () => {
    const { trigger, press } = setup(false);
    expect(press().defaultPrevented).toBe(true);
    expect(screen.getByText('Menu contents')).toBeTruthy();
    fireEvent.click(trigger, { detail: 1 });
    expect(
      document
        .querySelector('.mobile-touch-menu-content')
        ?.hasAttribute('data-expanded')
    ).toBe(true);
  });
  it.each([true, false])(
    'supports keyboard activation with openOnRelease=%s',
    (openOnRelease) => {
      const { trigger } = setup(openOnRelease);
      fireEvent.click(trigger, { detail: 0 });
      expect(screen.getByText('Menu contents')).toBeTruthy();
    }
  );
});
