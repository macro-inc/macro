/**
 * @vitest-environment jsdom
 */

import { useAppLinkChip } from '@core/component/LexicalMarkdown/component/core/app-link-opener';
import type { MessageData } from '@core/messages/types';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { Content } from '../Content';
import { MessageProvider } from '../context';

// The body says whether links in it would read as chips.
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: () => (
      <p>{useAppLinkChip() ? 'links read as chips' : 'plain links'}</p>
    ),
  })
);
vi.mock('../MentionedImages', () => ({ MentionedImages: () => null }));
vi.mock('@core/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/user')>()),
  isAgentAccount: (id: string | undefined) => id === 'macro|dee@agents.example',
}));

function message(senderId: string) {
  return {
    id: 'message-1',
    content: 'See my screen',
    sender_id: senderId,
    created_at: '2026-11-24T00:00:00.000Z',
    updated_at: '2026-11-24T00:00:00.000Z',
    attachments: [],
    reactions: [],
  } as unknown as MessageData;
}

function renderFrom(senderId: string) {
  return render(() => (
    <MessageProvider value={() => message(senderId)}>
      <Content />
    </MessageProvider>
  ));
}

describe('screen links in a channel message', () => {
  it('read as chips in an agent teammate’s message', () => {
    renderFrom('macro|dee@agents.example');
    expect(screen.getByText('links read as chips')).toBeTruthy();
  });

  it('stay plain links in a person’s message', () => {
    renderFrom('macro|ada@example.com');
    expect(screen.getByText('plain links')).toBeTruthy();
  });
});
