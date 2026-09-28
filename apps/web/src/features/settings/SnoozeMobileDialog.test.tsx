import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui/components/ImperativeDialog';
import { createSignal, getOwner } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const save = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn() },
}));
vi.mock('@core/util/dateSearch/useDateSearch', () => ({
  useDateSearch: () => () => [],
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  useMuteItemMutation: () => ({ mutateAsync: save }),
}));

beforeEach(() => {
  save.mockClear();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function tap(element: HTMLElement) {
  fireEvent.pointerDown(element, { pointerType: 'touch', button: 0 });
  fireEvent.pointerUp(element, { pointerType: 'touch', button: 0 });
  fireEvent.click(element);
}

function setup() {
  const [open, setOpen] = createSignal(true);
  function SettingsActions() {
    const owner = getOwner();
    return (
      <button
        type="button"
        onClick={() =>
          openSnoozeNotifications(
            [{ item_id: 'document-one', item_type: 'document' }],
            { owner }
          )
        }
      >
        Change time
      </button>
    );
  }
  render(() => (
    <>
      <MobileDrawer
        open={open()}
        onOpenChange={setOpen}
        closeOnOutsidePointerStrategy="pointerdown"
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Content aria-label="Settings">
            <SettingsActions />
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <ImperativeDialogHost />
    </>
  ));
  return { open };
}

describe('snooze pickers opened from mobile settings', () => {
  it.each(['save', 'cancel'] as const)(
    'keeps settings open while changing time and after %s',
    async (action) => {
      const settings = setup();
      tap(screen.getByRole('button', { name: 'Change time' }));
      const picker = await screen.findByRole('dialog', {
        name: 'Snooze notifications',
      });
      expect(settings.open()).toBe(true);
      expect(picker.hasAttribute('data-corvu-drawer-content')).toBe(true);
      tap(within(picker).getByRole('combobox'));
      expect(settings.open()).toBe(true);
      if (action === 'save') {
        tap(within(picker).getByRole('option', { name: /For 30 minutes/ }));
        await waitFor(() => expect(save).toHaveBeenCalledOnce());
      } else {
        tap(within(picker).getByRole('button', { name: 'Cancel' }));
        expect(save).not.toHaveBeenCalled();
      }
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Snooze notifications' })
        ).toBeNull()
      );
      expect(settings.open()).toBe(true);
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    }
  );
});
