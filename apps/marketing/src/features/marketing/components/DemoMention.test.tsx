import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoMentionText, serializeDemoEditor } from './DemoMention';
import { DemoMentionMenu } from './DemoMentionMenu';
import { ChannelComposer } from './email/frozen/ChannelComposer';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

function typeAtEnd(editor: HTMLElement, text: string) {
  const node = document.createTextNode(text);
  editor.append(node);
  editor.focus();
  const range = document.createRange();
  range.setStart(node, text.length);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.input(editor);
}

it('keeps multiple references atomic, formatted, and intact when the message is sent', () => {
  const onSend = vi.fn();
  render(() => (
    <>
      <DemoMentionMenu />
      <div class="workspace-demo">
        <ChannelComposer richMentions label="Message" onSend={onSend} />
      </div>
    </>
  ));
  const editor = screen.getByRole('textbox', { name: 'Message' });
  for (const query of ['@teo', '@web', '@announcement']) {
    typeAtEnd(editor, query);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  }
  expect(editor.textContent).toBe(
    '@Teo Website launch plan Write the launch announcement '
  );
  expect(editor.querySelectorAll('[contenteditable="false"]')).toHaveLength(3);
  expect(editor.querySelector('.mention-person')?.textContent).toBe('@Teo');
  expect(
    editor.querySelector('.mention-task .demo-mention-status')
  ).toBeTruthy();
  typeAtEnd(editor, 'please review these.');
  expect(screen.queryByRole('listbox')).toBeNull();
  const body = serializeDemoEditor(editor).trim();
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(onSend).toHaveBeenCalledExactlyOnceWith(body);
  expect(editor.textContent).toBe('');
  const result = render(() => (
    <div class="workspace-demo">
      <DemoMentionText text={body} />
    </div>
  ));
  expect(result.container.querySelectorAll('[data-demo-mention]')).toHaveLength(
    3
  );
  expect(result.container.textContent).toContain(
    '@Teo Website launch plan Write the launch announcement please review these.'
  );
  expect(result.container.textContent).not.toContain('demo-mention:');
});

it('keeps pasted HTML out of the draft and preserves existing mention nodes', () => {
  render(() => (
    <>
      <DemoMentionMenu />
      <div class="workspace-demo">
        <ChannelComposer richMentions onSend={() => {}} />
      </div>
    </>
  ));
  const editor = screen.getByRole('textbox');
  typeAtEnd(editor, '@teo');
  fireEvent.keyDown(editor, { key: 'Enter' });
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) =>
        type === 'text/plain' ? 'plain text' : '<img src="bad">',
    },
  });
  expect(editor.querySelector('img')).toBeNull();
  expect(editor.querySelector('[data-demo-mention="teo"]')).toBeTruthy();
  expect(editor.textContent).toBe('@Teo plain text');
});

it('renders Claude and Cursor as person mentions in both editors and sent messages', () => {
  render(() => (
    <>
      <DemoMentionMenu />
      <div class="workspace-demo">
        <ChannelComposer richMentions label="Message" onSend={() => {}} />
      </div>
    </>
  ));
  const editor = screen.getByRole('textbox', { name: 'Message' });
  for (const name of ['claude', 'cursor']) {
    typeAtEnd(editor, `@${name}`);
    fireEvent.keyDown(editor, { key: 'Enter' });
  }
  expect(editor.textContent).toBe('@Claude @Cursor ');
  expect(editor.querySelectorAll('.mention-person')).toHaveLength(2);
  expect(editor.querySelector('.demo-mention-icon')).toBeNull();
  const result = render(() => (
    <DemoMentionText text={serializeDemoEditor(editor)} />
  ));
  expect(result.container.textContent).toBe('@Claude @Cursor ');
  expect(result.container.querySelector('.demo-mention-icon')).toBeNull();
});
