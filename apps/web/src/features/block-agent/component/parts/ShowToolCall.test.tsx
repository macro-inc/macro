/** @vitest-environment jsdom */

import type { View } from '@app/features/dynamic-ui/schema';
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowToolCall } from './ShowToolCall';
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
}));

afterEach(cleanup);

function common(
  status: ToolCallCommon['status'] = 'completed'
): ToolCallCommon {
  return {
    id: 'show',
    label: 'Show',
    status,
    muted: status === 'failed',
    trailing: status === 'failed' ? 'Failed' : undefined,
  };
}

describe('ShowToolCall', () => {
  it('renders completed results inline without a tool row', () => {
    const view = {
      title: 'This week',
      widgets: [{ type: 'md', markdown: 'hi' }],
    };
    const rendered = render(() => (
      <ShowToolCall input={{ view }} common={common()} />
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
    const rendered = render(() => <ShowToolCall {...props} />);

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
        <ShowToolCall input={input} common={common()} />
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
  ] as const)(
    'shows nothing for a view turned back: %j',
    ({ status, error }) => {
      const rendered = render(() => (
        <ShowToolCall
          input={{
            view: { widgets: [{ type: 'md', markdown: 'Hidden result' }] },
          }}
          error={error}
          common={common(status)}
        />
      ));

      expect(rendered.container.innerHTML).toBe('');
    }
  );

  it('renders the widgets that match and counts the ones that do not', () => {
    const cards = {
      type: 'cards',
      title: 'Onboarding Summary',
      items: [{ type: 'document', id: 'doc-1' }],
    };
    const view = {
      title: 'Workspace Setup',
      widgets: [
        { type: 'tags', title: 'Created Tags' },
        { type: 'markdown', markdown: 'private-markdown' },
        cards,
      ],
    };
    const rendered = render(() => (
      <ShowToolCall input={{ view }} common={common()} />
    ));

    expect(rendered.getByTestId('dashboard').textContent).toBe(
      JSON.stringify({ title: 'Workspace Setup', widgets: [cards] })
    );
    expect(rendered.container.textContent).toContain(
      "Couldn't render 2 widgets — they didn't match the schema."
    );
    expect(rendered.container.textContent).not.toContain('private-markdown');
  });

  it('counts an unmatched widget only once the call ends', () => {
    const md = { type: 'md', markdown: 'Done so far' };
    const view = { widgets: [md, { type: 'md' }] };
    const [props, setProps] = createStore<{
      input: unknown;
      common: ToolCallCommon;
    }>({ input: { view }, common: common('running') });
    const rendered = render(() => <ShowToolCall {...props} />);

    expect(rendered.getByTestId('dashboard').textContent).toBe(
      JSON.stringify({ widgets: [md] })
    );
    expect(rendered.container.textContent).not.toContain("Couldn't render");

    setProps('common', common());
    expect(rendered.getByTestId('dashboard').textContent).toBe(
      JSON.stringify({ widgets: [md] })
    );
    expect(rendered.container.textContent).toContain(
      "Couldn't render one widget — it didn't match the schema."
    );
  });

  it('reports a render error before showing the fallback', () => {
    const rendered = render(() => (
      <ShowToolCall
        input={{ view: { title: 'throws', widgets: [] } }}
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
