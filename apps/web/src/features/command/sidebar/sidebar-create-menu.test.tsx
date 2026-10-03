import { TOKENS } from '@core/hotkey/tokens';
import type { HotkeyInterceptorContext } from '@core/hotkey/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarCreateMenu } from './sidebar-create-menu';

const host = vi.hoisted(() => ({
  createProject: vi.fn(),
  createTask: vi.fn(),
  taskDestination: (): string | undefined => undefined,
  registerInterceptor:
    vi.fn<(callback: (context: HotkeyInterceptorContext) => boolean) => void>(),
}));

vi.mock('@app/constants/hotkeys', () => ({
  CREATE_MENU_COMMAND_SCOPE: 'create-menu',
}));
vi.mock('@app/features/command/Launcher', () => ({
  useCreateMenuBlocks: () => () => [
    {
      label: 'Project',
      launcherHint: 'Plan work together',
      blockName: 'initiative',
      icon: () => null,
      hotkey: 'p',
      hotkeyToken: TOKENS.create.initiative,
      keyDownHandler: host.createProject,
    },
    {
      label: 'Task',
      blockName: 'task',
      icon: () => null,
      hotkey: 't',
      hotkeyToken: TOKENS.create.task,
      destinationHint: () => host.taskDestination(),
      keyDownHandler: host.createTask,
    },
  ],
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/hotkeyRoot', () => ({
  useHotkeyInterceptor: host.registerInterceptor,
}));
vi.mock('@core/hotkey/state', () => ({ setActiveScope: vi.fn() }));
vi.mock('@core/hotkey/utils', () => ({ activateClosestDOMScope: vi.fn() }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui/components/Hotkey', () => ({ Hotkey: () => null }));
vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Button')),
  ...(await import('@ui/components/Dropdown')),
  ...(await import('@ui/components/NavRow')),
  Hotkey: () => null,
}));

let menuStyles: HTMLStyleElement;
beforeEach(() => {
  vi.clearAllMocks();
  menuStyles = document.createElement('style');
  menuStyles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(menuStyles);
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('scrollTo', vi.fn());
  host.createProject.mockImplementation(() => {
    expect(screen.queryByRole('menu')).toBeNull();
    screen.getByRole('textbox', { name: 'Project name' }).focus();
  });
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.unstubAllGlobals();
  host.taskDestination = () => undefined;
});

async function openMenu() {
  render(() => (
    <>
      <SidebarCreateMenu variant="icon" />
      <input aria-label="Project name" />
    </>
  ));
  const trigger = screen.getByRole('button', { name: 'Create' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('menuitem', { name: 'Project' });
  return { trigger, item };
}

it.each(['pointer', 'keyboard', 'shortcut'] as const)(
  'hands focus to creation after %s selection dismisses the menu',
  async (mode) => {
    const { item } = await openMenu();
    if (mode === 'pointer') fireEvent.pointerUp(item, { button: 0 });
    else if (mode === 'keyboard') fireEvent.keyDown(item, { key: 'Enter' });
    else {
      const interceptor = host.registerInterceptor.mock.calls[0][0];
      expect(
        interceptor({
          pressedKeysString: 'p',
          pressedKeys: new Set(['p']),
          event: new KeyboardEvent('keydown', { key: 'p' }),
          activeScopeId: 'create-menu',
          isEditableFocused: false,
          eventType: 'keydown',
        })
      ).toBe(true);
    }
    expect(host.createProject).not.toHaveBeenCalled();
    await waitFor(() => expect(host.createProject).toHaveBeenCalledOnce());
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Project name' })
    );
  }
);

it('restores the trigger on dismissal without creating anything', async () => {
  const { trigger } = await openMenu();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(host.createProject).not.toHaveBeenCalled();
});

it('says where an entry creates, without launcher descriptions', async () => {
  host.taskDestination = () => 'In Launch';
  const { item } = await openMenu();
  const task = screen.getByRole('menuitem', { name: /Task/ });
  expect(task.textContent).toContain('In Launch');
  expect(item.textContent).toBe('Project');

  host.taskDestination = () => undefined;
  cleanup();
  await openMenu();
  expect(screen.getByRole('menuitem', { name: /Task/ }).textContent).toBe(
    'Task'
  );
});
