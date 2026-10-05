import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { DragDropProvider, DragDropSensors } from '@thisbeyond/solid-dnd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomizeSidebarModal } from './customize-sidebar-modal';
import { SidebarPrefsProvider, useSidebarPrefs } from './use-sidebar-prefs';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

beforeEach(() => {
  localStorage.removeItem('macro:sidebar:prefs');
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const handle = this.querySelector('[aria-label^="Reorder "]');
      const handles = [
        ...document.querySelectorAll('[aria-label^="Reorder "]'),
      ];
      const index = handle ? handles.indexOf(handle) : -1;
      return new DOMRect(100, 100 + Math.max(index, 0) * 40, 320, 40);
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Modal() {
  const { prefs } = useSidebarPrefs();
  return (
    <CustomizeSidebarModal
      open
      onOpenChange={() => {}}
      gates={{
        showCalendar: true,
        showCustomers: true,
        showReminders: true,
        showCalls: true,
        showReviews: true,
        get prefs() {
          return prefs();
        },
      }}
    />
  );
}

describe('sidebar customization drag sorting', () => {
  it('keeps row targets stable and isolates sorting from the app drag provider', async () => {
    const appCollision = vi.fn(() => null);
    const appDragEnd = vi.fn();
    render(() => (
      <DragDropProvider collisionDetector={appCollision} onDragEnd={appDragEnd}>
        <DragDropSensors />
        <SidebarPrefsProvider>
          <Modal />
        </SidebarPrefsProvider>
      </DragDropProvider>
    ));
    const handle = await screen.findByRole('button', {
      name: 'Reorder Reminders',
    });
    fireEvent.mouseDown(handle, { button: 0, clientX: 115, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 115, clientY: 200 });

    const drive = screen
      .getByRole('button', { name: 'Reorder Drive' })
      .closest<HTMLElement>('.rounded-lg')!;
    const targetTransform = drive.style.transform;
    expect(targetTransform).not.toBe('');
    // Repeated moves inside one slot must not alternate the sort preview.
    for (let offset = 0; offset < 5; offset++) {
      fireEvent.mouseMove(document, { clientX: 115 + offset, clientY: 200 });
      expect(drive.style.transform).toBe(targetTransform);
    }
    fireEvent.mouseUp(document, { button: 0, clientX: 120, clientY: 200 });
    expect(
      screen
        .getAllByRole('button', { name: /^Reorder / })
        .slice(0, 3)
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Reorder Drive', 'Reorder Email', 'Reorder Reminders']);
    expect(screen.queryByRole('button', { name: 'Reorder Home' })).toBeNull();
    expect(appCollision).not.toHaveBeenCalled();
    expect(appDragEnd).not.toHaveBeenCalled();
  });

  it('reloads persisted preferences for each sidebar mount', async () => {
    const mount = () =>
      render(() => (
        <SidebarPrefsProvider>
          <Modal />
        </SidebarPrefsProvider>
      ));
    mount();
    const reminders = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: 'Reminders',
    });
    expect(reminders.checked).toBe(true);
    fireEvent.click(reminders);
    expect(reminders.checked).toBe(false);
    cleanup();

    mount();
    expect(
      (
        await screen.findByRole<HTMLInputElement>('checkbox', {
          name: 'Reminders',
        })
      ).checked
    ).toBe(false);
    cleanup();

    localStorage.removeItem('macro:sidebar:prefs');
    mount();
    expect(
      (
        await screen.findByRole<HTMLInputElement>('checkbox', {
          name: 'Reminders',
        })
      ).checked
    ).toBe(true);
  });
});
