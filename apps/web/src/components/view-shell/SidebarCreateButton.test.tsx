import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireEvent, render, within } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SidebarCreateHeader } from './SidebarCreateButton';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

// Keep this focused on split ownership and visibility; the shared UI barrel
// initializes app-wide hotkey storage through its tooltip dependencies.
vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  ...(await import('../ui/utils/press')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
  ) => (
    <button
      aria-label={props.label}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  ),
}));

afterEach(() => vi.mocked(isTouchDevice).mockReturnValue(false));

function controller(canClose: () => boolean, close = vi.fn()) {
  return {
    canClose,
    close,
    canGoBack: () => false,
    goBack: vi.fn(),
    canGoForward: () => false,
    goForward: vi.fn(),
  };
}

it('closes the owning split without invoking either create action', () => {
  const home = controller(() => true);
  const tasks = controller(() => true);
  const createHome = vi.fn();
  const createTask = vi.fn();
  const view = render(() => (
    <>
      <SplitPanel.Root controller={home} aria-label="Home pane">
        <SidebarCreateHeader
          title="Home"
          label="New chat"
          onCreate={createHome}
        />
      </SplitPanel.Root>
      <SplitPanel.Root controller={tasks} aria-label="Tasks pane">
        <SidebarCreateHeader
          title="Tasks"
          label="New task"
          onCreate={createTask}
        />
      </SplitPanel.Root>
    </>
  ));
  const tasksPane = within(view.getByRole('region', { name: 'Tasks pane' }));
  fireEvent.click(tasksPane.getByRole('button', { name: 'Close' }));
  expect(tasks.close).toHaveBeenCalledOnce();
  expect(home.close).not.toHaveBeenCalled();
  expect(createHome).not.toHaveBeenCalled();
  expect(createTask).not.toHaveBeenCalled();
});

it('updates close visibility when the last remaining split cannot close', () => {
  const [canClose, setCanClose] = createSignal(true);
  const view = render(() => (
    <SplitPanel.Root controller={controller(canClose)}>
      <SidebarCreateHeader title="Email" label="New email" onCreate={vi.fn()} />
    </SplitPanel.Root>
  ));
  expect(view.queryByRole('button', { name: 'Close' })).not.toBeNull();
  setCanClose(false);
  expect(view.queryByRole('button', { name: 'Close' })).toBeNull();
  expect(view.queryByRole('button', { name: 'New email' })).not.toBeNull();
});

it('leaves touch headers without a desktop close control', () => {
  vi.mocked(isTouchDevice).mockReturnValue(true);
  const view = render(() => (
    <SplitPanel.Root controller={controller(() => true)}>
      <SidebarCreateHeader title="Home" label="New chat" onCreate={vi.fn()} />
    </SplitPanel.Root>
  ));
  expect(view.queryByRole('button', { name: 'Close' })).toBeNull();
  expect(view.queryByRole('button', { name: 'New chat' })).not.toBeNull();
});
