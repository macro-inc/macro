import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

// The real widgets fetch their own data; stand in for them, with one that
// fails to render, to check the dashboard keeps its other panes. Each stand-in
// reports the agent an agent pane naming none would show.
vi.mock('@app/features/dynamic-ui/render', () => ({
  Render: (props: { node: { type: string; id?: string } }) => {
    if (props.node.id === 'broken') throw new Error('bad pane');
    const agentId = useScopedAgentId(() => undefined);
    return (
      <p
        data-agent={agentId()}
      >{`${props.node.type}:${props.node.id ?? '-'}`}</p>
    );
  },
}));

import { useScopedAgentId } from '@app/features/dynamic-ui/widgets/panes/agent-scope';
import type { DashboardView } from '../../primitives/dashboard-view';
import { dashboard } from '../../tests/fake-dashboard';
import { DashboardBody } from './dashboard-body';

afterEach(cleanup);

it('renders every pane in order, and one failing pane alone', () => {
  const view = render(() => (
    <DashboardBody
      view={() => ({
        t: 'ready',
        dashboard: dashboard({
          view: {
            widgets: [
              { type: 'md', id: 'intro', markdown: 'a' },
              { type: 'md', id: 'broken', markdown: 'b' },
              { type: 'md', markdown: 'c' },
            ],
          },
        }),
      })}
      onRetry={() => undefined}
    />
  ));

  expect(
    view.getAllByRole('paragraph').map((pane) => pane.textContent)
  ).toEqual(['md:intro', 'md:-']);
  expect(view.getByText('This pane couldn’t be shown.')).toBeTruthy();
});

it('retries a failed load, then shows the dashboard', () => {
  const [state, setState] = createSignal<DashboardView>({ t: 'error' });
  const onRetry = vi.fn(() => setState({ t: 'ready', dashboard: dashboard() }));
  const view = render(() => <DashboardBody view={state} onRetry={onRetry} />);

  fireEvent.click(view.getByRole('button', { name: 'Try again' }));

  expect(onRetry).toHaveBeenCalledOnce();
  expect(view.getByText('md:intro')).toBeTruthy();
});

it("gives every pane the dashboard's owner as its agent", () => {
  const view = render(() => (
    <DashboardBody
      view={() => ({
        t: 'ready',
        dashboard: dashboard({ ownerId: 'macro|ops-agent@example.com' }),
      })}
      onRetry={() => undefined}
    />
  ));

  expect(
    view.getAllByRole('paragraph').map((pane) => pane.dataset.agent)
  ).toEqual(['macro|ops-agent@example.com', 'macro|ops-agent@example.com']);
});
