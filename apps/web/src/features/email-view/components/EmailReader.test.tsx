import { cleanup, render } from '@solidjs/testing-library';
import {
  type Accessor,
  type Component,
  createSignal,
  lazy,
  Suspense,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailReader } from './EmailReader';

// The outlet renders whichever thread view the test routes to.
const outlet = vi.hoisted(() => ({
  view: (() => undefined) as Accessor<Component | undefined>,
}));

vi.mock('@app/lib/split-router', async () => {
  const { Dynamic } = await import('solid-js/web');
  return {
    SplitRouter: {
      Outlet: (props: { fallback: Component }) => (
        <Dynamic component={outlet.view() ?? props.fallback} />
      ),
    },
  };
});

afterEach(cleanup);

function renderBesideList() {
  const [view, setView] = createSignal<Component>();
  outlet.view = view;
  const screen = render(() => (
    <Suspense fallback={<p>Loading Email</p>}>
      <div role="grid" aria-label="Email" tabIndex={0} />
      <EmailReader focusList={() => {}} setListPane={() => {}} />
    </Suspense>
  ));
  return { screen, setView };
}

it('shows the empty state until a thread opens', () => {
  const { screen } = renderBesideList();

  expect(screen.getByText('No conversation selected')).toBeTruthy();
});

it('keeps the list mounted and focused while the next thread loads', () => {
  const { screen, setView } = renderBesideList();
  setView(() => () => <p>First thread</p>);
  const list = screen.getByRole('grid');
  list.focus();

  setView(() => lazy(() => new Promise<{ default: Component }>(() => {})));

  expect(screen.queryByText('Loading Email')).toBeNull();
  expect(list.isConnected).toBe(true);
  expect(document.activeElement).toBe(list);
});
