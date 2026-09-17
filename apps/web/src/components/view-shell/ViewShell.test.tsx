import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { type JSX, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ViewShell } from './ViewShell';
import { ViewSidebar } from './ViewSidebar';

const measurement = vi.hoisted(() => ({ width: 1000 }));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => measurement,
}));
vi.mock('@core/component/Resize', () => ({
  Resize: {
    Zone: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    Panel: (props: { children: JSX.Element; collapsed?: () => boolean }) => (
      <div hidden={props.collapsed?.()}>{props.children}</div>
    ),
  },
}));
vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
  ) => (
    <button
      aria-label={props.label}
      aria-expanded={props['aria-expanded']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  measurement.width = 1000;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Workspace(props: { app: string; mounted?: () => void }) {
  function Content() {
    onMount(() => props.mounted?.());
    return <input aria-label={`${props.app} draft`} />;
  }
  return (
    <section aria-label={props.app}>
      <ViewShell.Root asidePreferenceKey={props.app}>
        <ViewShell.Aside>
          <ViewSidebar.Header>
            <ViewSidebar.Title>{props.app}</ViewSidebar.Title>
          </ViewSidebar.Header>
        </ViewShell.Aside>
        <ViewShell.Main>
          <ViewShell.TopBar>
            <h1>Selected item</h1>
          </ViewShell.TopBar>
          <Content />
        </ViewShell.Main>
      </ViewShell.Root>
    </section>
  );
}

it('hides only the owning split and keeps the current item mounted', () => {
  const mounted = vi.fn();
  render(() => (
    <>
      <Workspace app="email" mounted={mounted} />
      <Workspace app="tasks" />
    </>
  ));
  const email = within(screen.getByRole('region', { name: 'email' }));
  const tasks = within(screen.getByRole('region', { name: 'tasks' }));
  fireEvent.input(email.getByRole('textbox'), {
    target: { value: 'Unsent draft' },
  });
  fireEvent.click(email.getByRole('button', { name: 'Hide navigation' }));
  expect(email.queryByRole('button', { name: 'Hide navigation' })).toBeNull();
  expect(tasks.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  fireEvent.click(email.getByRole('button', { name: 'Show navigation' }));
  expect((email.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Unsent draft'
  );
  expect(mounted).toHaveBeenCalledTimes(1);
});

it('restores visibility per app after remount and persists reopening', () => {
  const first = render(() => <Workspace app="email" />);
  fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
  first.unmount();
  const second = render(() => (
    <>
      <Workspace app="email" />
      <Workspace app="calendar" />
    </>
  ));
  expect(
    within(screen.getByRole('region', { name: 'calendar' })).getByRole(
      'button',
      { name: 'Hide navigation' }
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  second.unmount();
  render(() => <Workspace app="email" />);
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
});

it('reopens automatic narrow collapse as a dismissible overlay', () => {
  measurement.width = 600;
  render(() => <Workspace app="documents" />);
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Hide navigation' }), {
    key: 'Escape',
  });
  expect(screen.getByRole('button', { name: 'Show navigation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Close navigation backdrop' })
  );
  expect(screen.getByRole('button', { name: 'Show navigation' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Close navigation backdrop' })
  ).toBeNull();
});
