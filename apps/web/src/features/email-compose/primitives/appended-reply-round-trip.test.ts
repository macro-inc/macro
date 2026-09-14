// @vitest-environment jsdom

import { $generateNodesFromDOM } from '@lexical/html';
import { ClassedBlockNode } from '@macro-inc/lexical-core';
import { $getRoot, $nodesOfType } from 'lexical';
import { describe, expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { createEmailEditor } from '../tests/editor';
import {
  prepareEmailBody,
  registerToggleAppendedThread,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from './prepare-email-body';

const replyingTo = message('original', {
  replying_to_id: 'parent-message-id',
  from: { name: 'Ada Lovelace', email: 'ada@example.com' },
  to: [],
  cc: [],
  bcc: [],
  subject: 'Numbers',
  body_html_sanitized: null,
  body_text: 'original message text',
  internal_date_ts: '2026-08-01T12:00:00Z',
  attachments: [],
});

function makeEditor() {
  const editor = createEmailEditor('my reply');
  registerToggleAppendedThread(editor);
  return editor;
}

function $collectMacroQuotes() {
  return $nodesOfType(ClassedBlockNode).filter((node) =>
    node.exportJSON().classes.includes('macro_quote')
  );
}

function appendQuote(editor: ReturnType<typeof makeEditor>) {
  editor.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
    replyingTo,
    replyType: 'reply',
    visible: true,
  });
}

function hideQuote(editor: ReturnType<typeof makeEditor>) {
  editor.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
    replyingTo,
    replyType: 'reply',
    visible: false,
  });
}

describe('appended reply draft round trip', () => {
  it('keeps one removable quote before and after saving and reloading a draft', () => {
    const editorA = makeEditor();
    appendQuote(editorA);
    editorA.read(() => expect($collectMacroQuotes()).toHaveLength(1));
    hideQuote(editorA);
    editorA.read(() => expect($collectMacroQuotes()).toHaveLength(0));
    appendQuote(editorA);
    const prepared = prepareEmailBody(editorA);
    const html = decodeBase64Utf8(prepared!.bodyHtml);

    // Reload path: setEditorStateFromHtml -> $generateNodesFromDOM.
    const editorB = makeEditor();
    editorB.update(() => {
      const dom = new DOMParser().parseFromString(html, 'text/html');
      const nodes = $generateNodesFromDOM(editorB, dom);
      const root = $getRoot();
      root.clear();
      root.append(...nodes);
    });

    editorB.read(() => {
      expect($collectMacroQuotes()).toHaveLength(1);
      expect($getRoot().getTextContent()).toContain('original message text');
    });
    editorB.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
      replyingTo,
      replyType: 'forward',
      visible: true,
    });
    editorB.read(() => {
      expect($collectMacroQuotes()).toHaveLength(1);
    });
    hideQuote(editorB);
    editorB.read(() => {
      expect($collectMacroQuotes()).toHaveLength(0);
      expect($getRoot().getTextContent().trim()).toBe('my reply');
    });
  });
});
