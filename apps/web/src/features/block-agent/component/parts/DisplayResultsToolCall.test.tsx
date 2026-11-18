/** @vitest-environment jsdom */

import type { View } from '@app/features/dynamic-ui/view';
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayResultsToolCall } from './DisplayResultsToolCall';
import type { ToolCallCommon } from './shared';

// Keep the real dashboard; replace entity widgets and Lexical context with
// presentation markers.
vi.mock('@app/features/dynamic-ui/DashboardToolView.lazy', async () => ({
  DashboardToolView: (
    await import('@app/features/dynamic-ui/DashboardToolView')
  ).default,
}));

vi.mock('@app/features/dynamic-ui/widget', () => ({
  Widget: {
    Compose: (props: { view: View }) => {
      if (props.view.title === 'throws') throw new TypeError('render failed');
      return <div data-testid="dashboard">{JSON.stringify(props.view)}</div>;
    },
  },
}));

const telemetryError = vi.hoisted(() => vi.fn());
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: telemetryError },
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
    status,
    muted: status === 'failed',
    stopped: false,
    trailing: status === 'failed' ? 'Failed' : undefined,
  };
}

const VIEW: View = {
  title: 'This week',
  widgets: [{ type: 'md', markdown: 'hi' }],
};

describe('DisplayResultsToolCall', () => {
  it('renders the returned view inline without a tool row', () => {
    const rendered = render(() => (
      <DisplayResultsToolCall view={VIEW} common={common()} />
    ));

    expect(rendered.getByTestId('dashboard').textContent).toBe(
      JSON.stringify(VIEW)
    );
    expect(rendered.container.querySelector('[data-tool-row]')).toBeNull();
  });

  it.each(['pending', 'running'] as const)(
    'shows nothing while the call is %s',
    (status) => {
      const rendered = render(() => (
        <DisplayResultsToolCall view={undefined} common={common(status)} />
      ));

      expect(rendered.container.textContent).toBe('');
    }
  );

  it('reports a finished call that returned no view', () => {
    const rendered = render(() => (
      <DisplayResultsToolCall view={undefined} common={common()} />
    ));

    expect(rendered.container.textContent).toContain(
      "Couldn't render dashboard"
    );
    expect(rendered.queryByTestId('dashboard')).toBeNull();
  });

  it.each([
    { status: 'failed', error: null },
    { status: 'completed', error: 'private-error-details' },
    { status: 'running', error: 'private-error-details' },
  ] as const)('shows only a failed summary for %j', ({ status, error }) => {
    const rendered = render(() => (
      <DisplayResultsToolCall
        view={VIEW}
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

  it('reports a render error before showing the fallback', () => {
    const rendered = render(() => (
      <DisplayResultsToolCall
        view={{ title: 'throws', widgets: [] }}
        common={common()}
      />
    ));

    expect(rendered.container.textContent).toContain(
      'Unable to display these results.'
    );
    expect(telemetryError).toHaveBeenCalledWith(expect.any(TypeError), {
      surface: 'display-results',
    });
  });
});
