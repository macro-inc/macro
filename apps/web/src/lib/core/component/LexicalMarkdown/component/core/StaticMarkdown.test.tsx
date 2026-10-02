import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { render, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { StaticMarkdownContext } from './StaticMarkdown';

vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob() {},
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('../decorator/LazyDecorator', () => ({
  LazyDecorator: (props: { render: () => JSX.Element }) => props.render(),
}));
vi.mock('@app/features/database-query/database-query', () => ({
  DatabaseLiveQuestion: (props: {
    source: { queryId: string; title?: string; displayMode: string };
    onSave?: unknown;
  }) => (
    <output data-query-id={props.source.queryId}>
      {props.source.title} · {props.source.displayMode} ·{' '}
      {props.onSave ? 'editable' : 'read-only'}
    </output>
  ),
}));

describe('assistant message database answers', () => {
  it('renders a saved-query block in a reply as the live answer', async () => {
    const block =
      '<m-db-query>{"queryId":"0b7d2c52-6f0e-4a8e-9f1f-5b0c1d2e3f40","databaseId":"1f0e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b","title":"Open tickets","prompt":"How many open tickets?","displayMode":"table"}</m-db-query>';
    const rendered = render(() => (
      <StaticMarkdownContext>
        <ChatMessageMarkdown
          text={`Here is the answer:\n\n${block}\n\nIt updates live.`}
          generating={() => false}
        />
      </StaticMarkdownContext>
    ));
    const answer = await waitFor(() => {
      const element = rendered.container.querySelector('[data-query-id]');
      if (!element) throw new Error('Live answer not rendered');
      return element;
    });
    expect(answer.getAttribute('data-query-id')).toBe(
      '0b7d2c52-6f0e-4a8e-9f1f-5b0c1d2e3f40'
    );
    expect(answer.textContent).toBe('Open tickets · table · read-only');
    expect(rendered.container.textContent).not.toContain('m-db-query');
    expect(rendered.container.textContent).toContain('It updates live.');
    rendered.unmount();
  });

  it('shows the unavailable fallback for an older inline-SQL block', () => {
    const rendered = render(() => (
      <StaticMarkdownContext>
        <ChatMessageMarkdown
          text='<m-db-query>{"sql":"SELECT 1","prompt":"One","displayMode":"table"}</m-db-query>'
          generating={() => false}
        />
      </StaticMarkdownContext>
    ));
    expect(rendered.container.querySelector('[data-query-id]')).toBeNull();
    expect(rendered.container.textContent).toContain(
      'Unavailable database question'
    );
    rendered.unmount();
  });
});
