/**
 * @vitest-environment jsdom
 */

import type { MessageData } from '@core/messages/types';
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { threadReplyInputId } from '../../Thread/utils/reply-input-id';
import { ActionMenu } from '../ActionMenu';
import { Root } from '../Root';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const message: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-2',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

function ReplyFocusHarness() {
  const [replying, setReplying] = createSignal(false);
  return (
    <>
      <Root
        message={message}
        actions={{
          onReply: () => {
            setReplying(true);
          },
        }}
      >
        <div data-message-content>hello</div>
        <ActionMenu />
      </Root>
      <Show when={replying()}>
        <div data-input-id={threadReplyInputId(message.id)}>
          <div
            contentEditable
            tabindex="0"
            data-testid="reply-editor"
            ref={(element) => {
              Object.defineProperty(element, 'offsetParent', {
                value: document.body,
              });
            }}
          />
        </div>
      </Show>
    </>
  );
}

describe('ActionMenu Reply focus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves the cursor into the reply composer after Reply is clicked', async () => {
    const { container } = render(() => <ReplyFocusHarness />);
    const root = container.querySelector<HTMLElement>('[data-message]')!;
    fireEvent.pointerEnter(root);
    const reply = container.querySelector<HTMLButtonElement>(
      '[data-message-action="reply"]'
    )!;

    fireEvent.pointerDown(reply);
    fireEvent.click(reply);

    await Promise.resolve();
    vi.runAllTimers();

    expect(document.activeElement).toBe(
      container.querySelector('[data-testid="reply-editor"]')
    );
  });
});
