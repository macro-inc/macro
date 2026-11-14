/**
 * @vitest-environment jsdom
 */

import { afterEach, expect, it } from 'vitest';
import { queryThreadReplyEditor, threadReplyInputId } from './reply-input-id';

afterEach(() => {
  document.body.replaceChildren();
});

it('keys a reply composer by its thread', () => {
  expect(threadReplyInputId('thread-1')).toBe('thread-reply-input-thread-1');
});

it('finds the mounted reply editor for a thread', () => {
  const root = document.createElement('div');
  root.setAttribute('data-input-id', threadReplyInputId('thread-1'));
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  root.append(editor);
  document.body.append(root);

  expect(queryThreadReplyEditor('thread-1')).toBe(editor);
  expect(queryThreadReplyEditor('thread-2')).toBeNull();
});
