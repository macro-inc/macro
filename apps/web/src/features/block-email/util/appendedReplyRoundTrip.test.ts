// @vitest-environment jsdom
import { $generateNodesFromDOM } from '@lexical/html';
import {
  $isClassedBlockNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import type { ApiMessage } from '@service-email/generated/schemas';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  prepareEmailBody,
  registerToggleAppendedThread,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from './prepareEmailBody';

function decodeBodyHtml(encoded: string) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(base64)));
}

const replyingTo = {
  replying_to_id: 'parent-message-id',
  from: { name: 'Ada Lovelace', email: 'ada@example.com' },
  to: [],
  cc: [],
  bcc: [],
  subject: 'Numbers',
  body_text: 'original message text',
  internal_date_ts: '2026-08-01T12:00:00Z',
  attachments: [],
} as unknown as ApiMessage;

function makeEditor() {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (e) => {
      throw e;
    },
  });
  registerToggleAppendedThread(editor);
  return editor;
}

function $collectMacroQuotes(): LexicalNode[] {
  const found: LexicalNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isClassedBlockNode(node) && node.__classes.includes('macro_quote')) {
      found.push(node);
    }
    if ('getChildren' in node) {
      for (const child of (node as any).getChildren()) visit(child);
    }
  };
  for (const child of $getRoot().getChildren()) visit(child);
  return found;
}

function appendQuote(editor: ReturnType<typeof makeEditor>) {
  editor.update(() => {
    const p = $createParagraphNode();
    p.append($createTextNode('my reply'));
    $getRoot().append(p);
  });
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
  it('hide removes a live-appended quote (control)', () => {
    const editor = makeEditor();
    appendQuote(editor);
    editor.read(() => {
      expect($collectMacroQuotes()).toHaveLength(1);
    });
    hideQuote(editor);
    editor.read(() => {
      expect($collectMacroQuotes()).toHaveLength(0);
    });
  });

  it('the draft-save export keeps the classed-block marker', () => {
    const editor = makeEditor();
    appendQuote(editor);
    // Draft saves run prepareEmailBody without appendReply (collectDraft).
    const prepared = prepareEmailBody(editor);
    expect(prepared).not.toBeNull();
    const html = decodeBodyHtml(prepared!.bodyHtml);
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    const quote = body.querySelector('.macro_quote');
    expect(quote).not.toBeNull();
    // ClassedBlockNode.importDOM only claims elements carrying this marker;
    // the authored sanitizer keeps data-* attributes, so if it's present here
    // it survives to body_html_sanitized.
    expect(quote!.getAttribute('data-classed-block')).toBe('true');
  });

  it('reloading the saved draft keeps the quote removable (reload case)', () => {
    const editorA = makeEditor();
    appendQuote(editorA);
    const prepared = prepareEmailBody(editorA);
    const html = decodeBodyHtml(prepared!.bodyHtml);

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
    });
    hideQuote(editorB);
    editorB.read(() => {
      expect($collectMacroQuotes()).toHaveLength(0);
    });
  });
});
