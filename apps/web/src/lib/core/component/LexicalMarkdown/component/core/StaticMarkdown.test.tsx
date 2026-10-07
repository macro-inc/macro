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
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  ENABLE_STATIC_DOCUMENT_CARDS: false,
  // Forms off for this viewer: recipients still get the card.
  isFeatureEnabled: () => false,
}));
vi.mock('../decorator/DocumentCard', () => ({
  DocumentCard: (props: { blockName: string; documentId: string }) => (
    <div data-card={props.blockName} data-card-id={props.documentId} />
  ),
}));
vi.mock('../decorator/DocumentMention', () => ({
  DocumentMention: (props: { blockName: string }) => (
    <span data-mention={props.blockName} />
  ),
  DocumentMentionStatic: (props: { blockName: string }) => (
    <span data-mention={props.blockName} />
  ),
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

describe('sent message document cards', () => {
  const card = (blockName: string, documentId: string) =>
    `<m-document-card>${JSON.stringify({ documentId, documentName: 'Lunch?', blockName })}</m-document-card>`;

  it('renders a form card as a card whatever the viewer’s forms flag, while other cards stay mentions until static cards roll out', () => {
    const rendered = render(() => (
      <StaticMarkdownContext>
        <ChatMessageMarkdown
          text={`${card('form', 'form-1')}\n\n${card('md', 'document-1')}`}
          generating={() => false}
        />
      </StaticMarkdownContext>
    ));
    expect(
      rendered.container
        .querySelector('[data-card="form"]')
        ?.getAttribute('data-card-id')
    ).toBe('form-1');
    expect(rendered.container.querySelector('[data-card="md"]')).toBeNull();
    expect(
      rendered.container.querySelector('[data-mention="md"]')
    ).toBeTruthy();
    rendered.unmount();
  });
});
