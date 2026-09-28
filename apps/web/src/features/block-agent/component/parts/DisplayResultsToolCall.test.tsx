/** @vitest-environment jsdom */

import type { View } from '@app/features/dynamic-ui/schema';
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayResultsToolCall } from './DisplayResultsToolCall';
import type { ToolCallCommon } from './shared';

// Keep the real dashboard schema validation and streaming behavior; replace
// entity widgets and Lexical context with presentation markers.
vi.mock('@app/features/dynamic-ui/DashboardToolView.lazy', async () => ({
  DashboardToolView: (
    await import('@app/features/dynamic-ui/DashboardToolView')
  ).default,
}));

vi.mock('@app/features/dynamic-ui/widget', () => ({
  Widget: {
    Compose: (props: { view: View }) => (
      <div data-testid="dashboard">{JSON.stringify(props.view)}</div>
    ),
  },
}));

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children?: JSX.Element }) =>
      props.children,
  })
);

vi.mock('@core/component/LexicalMarkdown/theme', () => ({ aiChatTheme: {} }));

vi.mock('../../ui', async () => ({
  isToolActive: (await import('../../ui/types')).isToolActive,
  ToolCard: (await import('../../ui/ToolCard')).ToolCard,
}));

afterEach(cleanup);

function common(
  status: ToolCallCommon['status'] = 'completed'
): ToolCallCommon {
  return {
    id: 'display-results',
    label: 'DisplayResults',
    server: 'macro',
    status,
    muted: status === 'failed',
    trailing: status === 'failed' ? 'Failed' : undefined,
  };
}

describe('DisplayResultsToolCall', () => {
  it('renders completed results inline without a tool row', () => {
    const view = {
      title: 'This week',
      widgets: [{ type: 'md', markdown: 'hi' }],
    };
    const rendered = render(() => (
      <DisplayResultsToolCall input={{ view }} common={common()} />
    ));

    expect(rendered.getByTestId('dashboard').textContent).toBe(
      JSON.stringify(view)
    );
    expect(rendered.container.querySelector('[data-tool-row]')).toBeNull();
  });

  it('waits for partial arguments, streams valid updates, and keeps the final view without a response', () => {
    const [props, setProps] = createStore<{
      input: unknown;
      common: ToolCallCommon;
    }>({ input: null, common: common('running') });
    const rendered = render(() => <DisplayResultsToolCall {...props} />);

    for (const status of ['pending', 'running'] as const) {
      for (const input of [null, {}, { view: null }, { view: {} }]) {
        setProps(reconcile({ input, common: common(status) }));
        expect(rendered.container.textContent).toBe('');
      }
    }

    const view = {
      title: 'This week',
      widgets: [{ type: 'md', markdown: 'First results' }],
    };
    setProps(reconcile({ input: { view }, common: common('running') }));
    expect(rendered.getByTestId('dashboard').textContent).toBe(
      JSON.stringify(view)
    );

    const finalView = {
      title: 'All results',
      widgets: [{ type: 'md', markdown: 'Final results' }],
    };
    setProps(reconcile({ input: { view: finalView }, common: common() }));
    expect(rendered.getByTestId('dashboard').textContent).toBe(
      JSON.stringify(finalView)
    );
    expect(rendered.container.querySelector('[data-tool-row]')).toBeNull();
  });

  it.each([null, {}, { view: null }, { view: { widgets: 'invalid-payload' } }])(
    'reports malformed completed input without exposing its payload: %j',
    (input) => {
      const rendered = render(() => (
        <DisplayResultsToolCall input={input} common={common()} />
      ));

      expect(rendered.container.textContent).toContain(
        "Couldn't render dashboard"
      );
      expect(rendered.container.textContent).not.toContain('invalid-payload');
      expect(rendered.queryByTestId('dashboard')).toBeNull();
      expect(rendered.queryByRole('button')).toBeNull();
    }
  );

  it.each([
    { status: 'failed', error: null },
    { status: 'completed', error: 'private-error-details' },
    { status: 'running', error: 'private-error-details' },
  ] as const)('shows only a failed summary for %j', ({ status, error }) => {
    const rendered = render(() => (
      <DisplayResultsToolCall
        input={{
          view: { widgets: [{ type: 'md', markdown: 'Hidden result' }] },
        }}
        error={error}
        common={common(status)}
      />
    ));

    expect(rendered.getByText('Failed')).toBeTruthy();
    const row = rendered.container.querySelector('[data-tool-row]');
    expect(row?.getAttribute('data-tool-status')).toBe('failed');
    expect(row?.classList.contains('opacity-75')).toBe(true);
    expect(rendered.queryByTestId('dashboard')).toBeNull();
    expect(rendered.queryByRole('button')).toBeNull();
    expect(rendered.container.textContent).not.toContain(
      'private-error-details'
    );
    expect(rendered.container.querySelector('.magic-chip-shimmer')).toBeNull();
  });
});
