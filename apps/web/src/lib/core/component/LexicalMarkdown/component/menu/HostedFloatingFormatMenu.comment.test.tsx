import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import type { FormatMenuHost } from '../../editing/overlay-hosts/format';
import { HostedFloatingFormatMenu } from './FloatingFormatMenu';

// jsdom has no layout observers; floatWithSelection only needs construction.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
afterEach(cleanup);

function setup(options: { interactable: boolean; insert: () => boolean }) {
  const root = document.createElement('div');
  root.textContent = 'Selected text';
  document.body.append(root);
  const [canComment, setCanComment] = createSignal(true);
  const [live, setLive] = createSignal(true);
  let popup: Parameters<FormatMenuHost['registerPopup']>[0] | undefined;
  const formatText = vi.fn();
  const host: FormatMenuHost = {
    selection: () => undefined,
    isInteractable: () => options.interactable,
    root: () => (live() ? root : null),
    focus: () => {},
    formatText,
    formatBlock: formatText,
    requestLink: () => {},
    unlink: () => {},
    registerPopup(callbacks) {
      popup = callbacks;
    },
    registerListeners: () => {},
  };
  const insert = vi.fn(options.insert);
  render(() => (
    <FloatingMenuGroup>
      <HostedFloatingFormatMenu
        host={host}
        options={{
          showLinkButton: false,
          commentAction: {
            canComment,
            render: (close) => (
              <button
                type="button"
                onClick={() => {
                  if (insert()) close();
                }}
              >
                Comment
              </button>
            ),
          },
        }}
      />
    </FloatingMenuGroup>
  ));
  const open = async () => {
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    popup?.visible(true);
    popup?.selection(selection ?? undefined);
    // The menu lags its open state by 100 ms.
    await new Promise((resolve) => setTimeout(resolve, 150));
  };
  return { open, insert, formatText, setCanComment, setLive };
}

const button = (name: string) => screen.queryByRole('button', { name });

test('a commenter sees only Comment; a failed insert keeps the menu, success closes it', async () => {
  let created = false;
  const harness = setup({ interactable: false, insert: () => created });
  await harness.open();
  expect(button('Comment')).not.toBeNull();
  expect(button('Bold')).toBeNull();
  expect(document.querySelector('[role="separator"], hr')).toBeNull();

  fireEvent.click(button('Comment')!);
  expect(harness.insert).toHaveBeenCalledOnce();
  expect(button('Comment')).not.toBeNull();

  created = true;
  fireEvent.click(button('Comment')!);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(button('Comment')).toBeNull();
  expect(harness.formatText).not.toHaveBeenCalled();
});

test('revoking comment access or losing the live root hides the commenter menu', async () => {
  const harness = setup({ interactable: false, insert: () => false });
  await harness.open();
  expect(button('Comment')).not.toBeNull();
  harness.setCanComment(false);
  expect(button('Comment')).toBeNull();
  harness.setCanComment(true);
  expect(button('Comment')).not.toBeNull();
  harness.setLive(false);
  expect(button('Comment')).toBeNull();
});

test('an editor keeps the formatting controls with Comment after them', async () => {
  const harness = setup({ interactable: true, insert: () => false });
  await harness.open();
  expect(button('Bold')).not.toBeNull();
  // One divider separates the formatting controls from Comment.
  expect(
    button('Comment')?.previousElementSibling?.getAttribute('role')
  ).toBe('separator');
});
