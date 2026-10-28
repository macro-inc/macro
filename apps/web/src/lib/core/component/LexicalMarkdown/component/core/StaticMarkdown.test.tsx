import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { replaceCitations } from '../../citationsUtils';
import { StaticMarkdown, StaticMarkdownContext } from './StaticMarkdown';

const agentPreview = vi.hoisted(() => ({
  label: (): string => 'Loading session',
  mounted: vi.fn(),
}));

vi.mock('../../citationsUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../citationsUtils')>();
  return { ...actual, replaceCitations: vi.fn(actual.replaceCitations) };
});

vi.mock('../decorator/AgentSessionMention', () => ({
  AgentSessionMention: () => {
    // Query setup can synchronously read its current reactive snapshot.
    agentPreview.mounted(agentPreview.label());
    return <span data-session-preview>{agentPreview.label()}</span>;
  },
}));

vi.mock('../decorator/BookingLinkMention', () => ({
  BookingLinkMention: (props: {
    profileId: string;
    slug?: string;
    url: string;
  }) => (
    <span data-test-booking-link={props.profileId} data-test-url={props.url}>
      {props.slug ?? props.profileId}
    </span>
  ),
}));

vi.mock('../decorator/PullRequestMention', () => ({
  PullRequestMention: (props: { id: string; url?: string; label?: string }) => (
    <span data-pr-chip={props.id || props.url}>{props.label}</span>
  ),
}));

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

describe('static agent session previews', () => {
  it('updates a preview without remounting its query on every result', async () => {
    const [label, setLabel] = createSignal('Loading session');
    agentPreview.label = label;
    agentPreview.mounted.mockClear();
    const rendered = render(() => (
      <StaticMarkdownContext>
        <StaticMarkdown
          markdown='<m-agent-session-mention>{"id":"session-1","label":"Session"}</m-agent-session-mention>'
          singleLine
        />
      </StaticMarkdownContext>
    ));
    // Let the asynchronous citation pass finish its initial render too.
    await waitFor(() => {
      expect(rendered.container.textContent).toContain('Loading session');
    });
    const preview = rendered.container.querySelector('[data-session-preview]');
    const mounts = agentPreview.mounted.mock.calls.length;

    setLabel('Loaded session');
    expect(rendered.container.textContent).toContain('Loaded session');
    expect(rendered.container.querySelector('[data-session-preview]')).toBe(
      preview
    );
    expect(agentPreview.mounted).toHaveBeenCalledTimes(mounts);
    rendered.unmount();
  });
});

describe('display-only markdown previews', () => {
  it('keeps formatted message text and mention names outside the inert subtree', () => {
    const [markdown, setMarkdown] = createSignal(
      'Review **the plan** with <m-document-mention>{"documentId":"plan-1","documentName":"Launch plan","blockName":"md","blockParams":{}}</m-document-mention>'
    );
    const rendered = render(() => (
      <StaticMarkdownContext>
        <StaticMarkdown inert markdown={markdown()} singleLine />
      </StaticMarkdownContext>
    ));

    const accessibleText = rendered.getByText(
      'Review the plan with Launch plan'
    );
    expect(accessibleText.closest('[inert], [aria-hidden="true"]')).toBeNull();

    setMarkdown('Updated **plan**');
    expect(rendered.queryByText('Review the plan with Launch plan')).toBeNull();
    expect(
      rendered
        .getByText('Updated plan')
        .closest('[inert], [aria-hidden="true"]')
    ).toBeNull();
    rendered.unmount();
  });
});

describe('static pull request mentions', () => {
  it.each([
    [
      'a Macro id',
      '<m-pr-mention>{"id":"foreign-1","label":"macro-inc/macro#7956"}</m-pr-mention>',
      'foreign-1',
    ],
    [
      'a GitHub URL',
      '<m-pr-mention>{"url":"https://github.com/macro-inc/macro/pull/7956","label":""}</m-pr-mention>',
      'https://github.com/macro-inc/macro/pull/7956',
    ],
  ])('renders a PR chip from %s', (_, markdown, target) => {
    const rendered = render(() => (
      <StaticMarkdownContext>
        <StaticMarkdown markdown={markdown} target="internal" lazy={false} />
      </StaticMarkdownContext>
    ));
    expect(
      rendered.container
        .querySelector('[data-pr-chip]')
        ?.getAttribute('data-pr-chip')
    ).toBe(target);
    rendered.unmount();
  });
});

describe('static markdown citations', () => {
  it('keeps the rendered DOM for markdown without citations', async () => {
    vi.mocked(replaceCitations).mockClear();
    const rendered = render(() => (
      <StaticMarkdownContext>
        <StaticMarkdown markdown="plain **reply**" lazy={false} />
      </StaticMarkdownContext>
    ));
    const paragraph = rendered.container.querySelector('p');
    expect(paragraph?.textContent).toBe('plain reply');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rendered.container.querySelector('p')).toBe(paragraph);
    expect(replaceCitations).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('ignores a citation lookup that finishes after newer markdown', async () => {
    const lookups = new Map<string, (content: string) => void>();
    vi.mocked(replaceCitations).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          lookups.set(input, resolve);
        })
    );
    const [markdown, setMarkdown] = createSignal('first [[old]]');
    const rendered = render(() => (
      <StaticMarkdownContext>
        <StaticMarkdown markdown={markdown()} lazy={false} />
      </StaticMarkdownContext>
    ));
    setMarkdown('second [[new]]');

    lookups.get('second [[new]]')?.('second resolved');
    await waitFor(() => {
      expect(rendered.container.textContent).toBe('second resolved');
    });
    lookups.get('first [[old]]')?.('first resolved');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rendered.container.textContent).toBe('second resolved');
    vi.mocked(replaceCitations).mockReset();
    rendered.unmount();
  });
});
