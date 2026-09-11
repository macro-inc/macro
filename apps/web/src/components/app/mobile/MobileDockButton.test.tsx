import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileDockButton } from './MobileDockButton';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));
afterEach(cleanup);
function setup() {
  const activate = vi.fn();
  const { getByRole } = render(() => (
    <MobileDockButton
      icon={() => <svg />}
      ariaLabel="Calendar"
      animateIcon={false}
      onClick={activate}
    />
  ));
  const button = getByRole('button');
  const press = (pointerType: string, isPrimary = true, mouseButton = 0) => {
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(event, { pointerType, isPrimary, button: mouseButton });
    fireEvent(button, event);
    return event;
  };
  return { activate, button, press };
}
describe('mobile dock activation', () => {
  it.each(['touch', 'pen'])(
    'activates on %s down without a duplicate release action',
    (pointerType) => {
      const { activate, button, press } = setup();
      expect(press(pointerType).defaultPrevented).toBe(true);
      expect(activate).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(button);
      fireEvent.click(button, { detail: 1 });
      expect(activate).toHaveBeenCalledTimes(1);
      press(pointerType);
      expect(activate).toHaveBeenCalledTimes(2);
    }
  );
  it('keeps mouse activation on click and ignores secondary presses', () => {
    const { activate, button, press } = setup();
    press('mouse');
    press('touch', false);
    press('mouse', true, 2);
    expect(activate).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 1 });
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('keeps keyboard and assistive clicks working after a cancelled touch', () => {
    const { activate, button, press } = setup();
    press('touch');
    fireEvent.pointerCancel(button);
    fireEvent.click(button, { detail: 0 });
    expect(activate).toHaveBeenCalledTimes(2);
  });
  it('prevents compatibility mouse-down from stealing focus after touch activation', () => {
    const { button, press } = setup();
    press('touch');
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(button, event);
    expect(event.defaultPrevented).toBe(true);
  });
});
