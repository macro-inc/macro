import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewBreadcrumbs } from './ViewBreadcrumbs';

vi.mock('@ui', () => ({
  Button: (props: {
    'aria-current'?: 'page';
    children: JSX.Element;
    class?: string;
    onClick?: () => void;
  }) => (
    <button
      aria-current={props['aria-current']}
      class={props.class}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === 'string').join(' '),
}));

afterEach(cleanup);

describe('ViewBreadcrumbs registration', () => {
  it('renders registered items in order and removes unmounted items', () => {
    const [showParent, setShowParent] = createSignal(true);

    const view = render(() => (
      <ViewBreadcrumbs.Provider>
        <ViewBreadcrumbs.Register id="current" order={20} current>
          Task
        </ViewBreadcrumbs.Register>
        <Show when={showParent()}>
          <ViewBreadcrumbs.Register id="parent" order={10}>
            Tasks
          </ViewBreadcrumbs.Register>
        </Show>
        <ViewBreadcrumbs.Outlet />
      </ViewBreadcrumbs.Provider>
    ));

    expect(
      screen.getAllByRole('button').map((item) => item.textContent)
    ).toEqual(['Tasks', 'Task']);
    expect(
      screen.getByRole('button', { name: 'Task' }).getAttribute('aria-current')
    ).toBe('page');
    expect(view.container.querySelectorAll('svg')).toHaveLength(1);

    setShowParent(false);

    expect(
      screen.getAllByRole('button').map((item) => item.textContent)
    ).toEqual(['Task']);
    expect(view.container.querySelectorAll('svg')).toHaveLength(0);
  });
});
