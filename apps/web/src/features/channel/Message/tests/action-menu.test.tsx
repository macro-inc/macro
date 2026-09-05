/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ActionMenu } from '../ActionMenu';
import { Root } from '../Root';
import type { MessageData } from '../types';

const message: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-2',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

describe('ActionMenu', () => {
  it('mounts only while its message is hovered', () => {
    const onPointerEnter = vi.fn();
    const { container } = render(() => (
      <Root
        message={message}
        actions={{ onReact: () => undefined }}
        onPointerEnter={onPointerEnter}
      >
        <ActionMenu />
      </Root>
    ));
    const root = container.querySelector<HTMLElement>('[data-message]');

    expect(root).not.toBeNull();
    expect(container.querySelector('[data-message-hover-actions]')).toBeNull();

    fireEvent.pointerEnter(root!);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-message-hover-actions]')
    ).not.toBeNull();

    fireEvent.pointerLeave(root!);

    expect(container.querySelector('[data-message-hover-actions]')).toBeNull();
  });

  it('stays mounted while its emoji popover is open', () => {
    const { container } = render(() => (
      <Root message={message} actions={{ onReact: () => undefined }}>
        <ActionMenu />
      </Root>
    ));
    const root = container.querySelector<HTMLElement>('[data-message]');

    fireEvent.pointerEnter(root!);
    const emojiMenuTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="More reactions"]'
    );
    expect(emojiMenuTrigger).not.toBeNull();

    fireEvent.click(emojiMenuTrigger!);
    fireEvent.pointerLeave(root!);

    expect(
      container.querySelector('[data-message-hover-actions]')
    ).not.toBeNull();
  });

  it('mounts while focus is within the message', () => {
    const { container } = render(() => (
      <Root message={message} actions={{ onReact: () => undefined }}>
        <button type="button">Message control</button>
        <ActionMenu />
      </Root>
    ));
    const root = container.querySelector<HTMLElement>('[data-message]');
    const control = container.querySelector<HTMLButtonElement>('button');

    expect(root).not.toBeNull();
    expect(control).not.toBeNull();
    expect(container.querySelector('[data-message-hover-actions]')).toBeNull();

    fireEvent.focusIn(control!);

    expect(
      container.querySelector('[data-message-hover-actions]')
    ).not.toBeNull();

    fireEvent.focusOut(control!, { relatedTarget: document.body });

    expect(container.querySelector('[data-message-hover-actions]')).toBeNull();
  });

  it('passes browser-selected message text to Reply', () => {
    const onReply = vi.fn();
    const { container } = render(() => (
      <Root message={message} actions={{ onReply }}>
        <div data-message-content>only this phrase should be quoted</div>
        <ActionMenu />
      </Root>
    ));
    const root = container.querySelector<HTMLElement>('[data-message]')!;
    const content = container.querySelector<HTMLElement>(
      '[data-message-content]'
    )!;
    const range = document.createRange();
    range.setStart(content.firstChild!, 5);
    range.setEnd(content.firstChild!, 16);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.pointerEnter(root);
    const reply = container.querySelector<HTMLButtonElement>(
      '[data-message-action="reply"]'
    )!;
    fireEvent.pointerDown(reply);
    fireEvent.click(reply);

    expect(onReply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedText: 'this phrase' })
    );
  });

  it('passes resolved decorator text to Reply', () => {
    const onReply = vi.fn();
    const { container } = render(() => (
      <Root message={message} actions={{ onReply }}>
        <div data-message-content>
          <div data-message-reply-preview>Resolved bot response</div>
        </div>
        <ActionMenu />
      </Root>
    ));
    const root = container.querySelector<HTMLElement>('[data-message]')!;

    fireEvent.pointerEnter(root);
    const reply = container.querySelector<HTMLButtonElement>(
      '[data-message-action="reply"]'
    )!;
    fireEvent.pointerDown(reply);
    fireEvent.click(reply);

    expect(onReply).toHaveBeenCalledWith(
      expect.objectContaining({ renderedText: 'Resolved bot response' })
    );
  });
});
