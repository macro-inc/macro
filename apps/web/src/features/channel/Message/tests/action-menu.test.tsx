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
});
