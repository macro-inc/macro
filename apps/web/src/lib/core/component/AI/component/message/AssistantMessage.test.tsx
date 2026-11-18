/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantMessage } from './AssistantMessage';

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ replaceOrInsertSplit: () => {} }),
}));
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }
  ) => (
    <button type="button" aria-label={props.tooltip} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
vi.mock('@entity/components/PulsingStar', () => ({ PulsingStar: () => null }));
vi.mock('@core/component/AI/component/message/ChatMessageMarkdown', () => ({
  ChatMessageMarkdown: () => null,
}));
vi.mock('./AssistantMessageParts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./AssistantMessageParts')>()),
  AssistantMessageParts: () => <div data-testid="parts" />,
}));

afterEach(cleanup);

it('renders nothing for a message that only looked up tools', () => {
  render(() => (
    <AssistantMessage
      message={{
        id: 'message-1',
        role: 'assistant',
        attachments: [],
        content: [
          { type: 'toolCall', id: 'search', name: 'SearchTools', json: {} },
          {
            type: 'toolCallResponseJson',
            id: 'search',
            name: 'SearchTools',
            json: {},
          },
          { type: 'toolCall', id: 'docs', name: 'ReadCodeDocs', json: {} },
          {
            type: 'toolCallErr',
            id: 'docs',
            name: 'ReadCodeDocs',
            description: 'Unknown symbol',
          },
        ],
      }}
    />
  ));
  expect(screen.queryByTestId('parts')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Copy assistant response' })
  ).toBeNull();
});

it('still renders a message whose lookups came with real work', () => {
  render(() => (
    <AssistantMessage
      message={{
        id: 'message-2',
        role: 'assistant',
        attachments: [],
        content: [
          { type: 'toolCall', id: 'search', name: 'SearchTools', json: {} },
          { type: 'text', text: 'Here is what I found.' },
        ],
      }}
    />
  ));
  expect(screen.getByTestId('parts')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Copy assistant response' })
  ).toBeTruthy();
});
