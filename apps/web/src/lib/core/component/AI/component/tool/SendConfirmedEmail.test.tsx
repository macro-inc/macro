import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { sendConfirmedEmailHandler } from './SendConfirmedEmail';

vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: () => null,
}));
vi.mock('./email/ChatCompose', () => ({
  ComposeTool: () => null,
}));
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  cn: (...classes: string[]) => classes.join(' '),
}));

const send = {
  subject: 'Q3 plan',
  body: 'Attached.',
  to: [{ email: 'ada@example.com', name: 'Ada Lovelace' }],
  userConfirmation: 'yes, send it',
};

it('shows the send once its result arrives after the row mounted', () => {
  const [response, setResponse] =
    createSignal<NamedTool<'SendConfirmedEmail', 'response'>>();
  render(() => (
    <sendConfirmedEmailHandler.render
      tool={{ id: 'call-1', name: 'SendConfirmedEmail', data: send }}
      response={response()}
      chat_id="chat-1"
      message_id="message-1"
      part_index={0}
      isComplete={response() !== undefined}
      renderContext={{ isStreaming: false, followedBy: () => false }}
    />
  ));
  expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  expect(screen.queryByText(/Email sent to/)).toBeNull();

  setResponse({
    id: 'call-1',
    name: 'SendConfirmedEmail',
    data: {
      sent: {
        message_id: '01a16cb6-0000-7000-8000-000000000001',
        thread_id: '01a16cb6-0000-7000-8000-000000000002',
      },
    },
  });

  expect(screen.getByText(/Email sent to/)).toBeTruthy();
});
