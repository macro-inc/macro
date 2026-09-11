import { buildAgentSessionMentionMarkdown } from '@macro-inc/lexical-core';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticMarkdown, StaticMarkdownContext } from './StaticMarkdown';

vi.mock('../decorator/AgentSessionMention', () => ({
  AgentSessionMention: (props: {
    id: string;
    label?: string;
    expanded?: boolean;
  }) => (
    <span data-session-id={props.id} data-expanded={props.expanded}>
      {props.label}
    </span>
  ),
}));

vi.mock('../decorator/AgentContext', () => ({ AgentContext: () => null }));
vi.mock('../decorator/Await', () => ({ Await: () => null }));
vi.mock('../decorator/ConnectApp', () => ({ ConnectApp: () => null }));
vi.mock('../decorator/ContactMention', () => ({ ContactMention: () => null }));
vi.mock('../decorator/DateMention', () => ({ DateMention: () => null }));
vi.mock('../decorator/DocumentCard', () => ({ DocumentCard: () => null }));
vi.mock('../decorator/Equation', () => ({ Equation: () => null }));
vi.mock('../decorator/GroupMention', () => ({ GroupMention: () => null }));
vi.mock('../decorator/MagicChip', () => ({ MagicChip: () => null }));
vi.mock('../decorator/MarkdownImage', () => ({ MarkdownImage: () => null }));
vi.mock('../decorator/MarkdownVideo', () => ({ MarkdownVideo: () => null }));
vi.mock('../decorator/PasteNode', () => ({ PasteNode: () => null }));
vi.mock('../decorator/ReplyTarget', () => ({ ReplyTarget: () => null }));
vi.mock('../decorator/Snapshot', () => ({ Snapshot: () => null }));
vi.mock('../decorator/TagMention', () => ({ TagMention: () => null }));
vi.mock('../decorator/ThemeMention', () => ({ ThemeMention: () => null }));
vi.mock('../decorator/UnknownMention', () => ({ UnknownMention: () => null }));
vi.mock('../decorator/UserMention', () => ({ UserMention: () => null }));
vi.mock('../decorator/Watermark', () => ({ Watermark: () => null }));
vi.mock('../decorator/DocumentMention', () => ({
  DocumentMention: () => null,
  DocumentMentionStatic: () => null,
}));
vi.mock('../accessory/CodeBoxAccessory', () => ({
  StaticCodeBoxAccessory: () => null,
}));
vi.mock('./LinkWithPreview', () => ({ LinkWithPreview: () => null }));

vi.mock('../../citationsUtils', () => ({
  replaceCitations: async (text: string) => text,
}));
vi.mock('../../plugins', () => ({
  $applyDocumentMetadataFromSerialized: () => {},
  $getDocumentMetadata: () => undefined,
}));

afterEach(cleanup);
const info = { id: 'session-1', label: 'Fix mentions' };
const mention = buildAgentSessionMentionMarkdown(info);

describe('sent agent session mentions', () => {
  it.each([
    [mention, 'Fix mentions'],
    [`${mention} followed by text`, 'Fix mentions followed by text'],
    [`Before ${mention} after`, 'Before Fix mentions after'],
  ])(
    'renders the session and surrounding text: %s',
    async (markdown, expected) => {
      const view = render(() => (
        <StaticMarkdownContext>
          <StaticMarkdown markdown={markdown} target="internal" />
        </StaticMarkdownContext>
      ));
      await waitFor(() => expect(view.container.textContent).toBe(expected));
      expect(
        view.container.querySelector('[data-session-id="session-1"]')
      ).not.toBeNull();
    }
  );

  it('passes the persisted expanded state to the session renderer', async () => {
    const markdown = buildAgentSessionMentionMarkdown({
      ...info,
      expanded: true,
    });
    const view = render(() => (
      <StaticMarkdownContext>
        <StaticMarkdown markdown={markdown} target="internal" />
      </StaticMarkdownContext>
    ));
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-expanded="true"]')
      ).not.toBeNull()
    );
  });
});
