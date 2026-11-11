import { $insertGeneratedNodes } from '@lexical/clipboard';
import { $createQuoteNode, registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  PASTE_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownPastePlugin } from '../plugins/markdown-paste/markdownPastePlugin';
import { behaviorEditor } from './editor';

// jsdom has no native clipboard. Only supply the missing event/data boundary;
// the parser, selection, clipboard command and editor plugins are production.
class FixtureClipboardEvent extends Event {}
beforeEach(() => vi.stubGlobal('ClipboardEvent', FixtureClipboardEvent));
afterEach(() => vi.unstubAllGlobals());

describe('markdown clipboard precedence', () => {
  it.each([
    { mime: 'text/html', value: '<b>rich</b>' },
    { mime: 'application/x-lexical-editor', value: '{"namespace":"other"}' },
  ])('yields to a richer $mime clipboard', ({ mime, value }) => {
    const { editor } = behaviorEditor(markdownPastePlugin());
    const event = new ClipboardEvent('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) =>
          ({ [mime]: value, 'text/plain': '**plain**' })[type] ?? '',
      },
    });
    editor.update(
      () => {
        $getRoot().append($createParagraphNode()).selectEnd();
        expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(false);
      },
      { discrete: true }
    );
    expect(event.defaultPrevented).toBe(false);
    editor.read(() => expect($getRoot().getTextContent()).toBe(''));
  });

  it.each([
    { markdown: '# Heading', tag: 'h1', text: 'Heading' },
    { markdown: '**bold**', tag: 'strong', text: 'bold' },
    { markdown: '> Quote', tag: 'blockquote', text: 'Quote' },
    { markdown: '- item', tag: 'li', text: 'item' },
    { markdown: '`code`', tag: 'code', text: 'code' },
  ])('parses plain clipboard Markdown $markdown', ({ markdown, tag, text }) => {
    const { editor, root } = behaviorEditor(markdownPastePlugin());
    const event = new ClipboardEvent('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? markdown : ''),
      },
    });
    editor.update(
      () => {
        $getRoot().append($createParagraphNode()).selectEnd();
        expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
      },
      { discrete: true }
    );
    expect(event.defaultPrevented).toBe(true);
    expect(root.querySelector(tag)?.textContent).toBe(text);
  });

  it('Shift bypasses Markdown interpretation and keyup restores it', () => {
    const { editor, root } = behaviorEditor(markdownPastePlugin());
    editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
      discrete: true,
    });
    const event = new ClipboardEvent('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? '**bold**' : ''),
      },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    editor.update(
      () => expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(false),
      { discrete: true }
    );
    expect(root.textContent).toBe('');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    editor.update(
      () => expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true),
      { discrete: true }
    );
    expect(root.querySelector('strong')?.textContent).toBe('bold');
  });

  it.each(['no-data', 'empty-text', 'no-selection'] as const)(
    'yields for %s',
    (mode) => {
      const { editor } = behaviorEditor(markdownPastePlugin());
      const event = new ClipboardEvent('paste', { cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value:
          mode === 'no-data'
            ? null
            : {
                getData: (type: string) =>
                  type === 'text/plain' && mode === 'no-selection'
                    ? 'text'
                    : '',
              },
      });
      editor.update(
        () => {
          if (mode !== 'no-selection')
            $getRoot().append($createParagraphNode()).selectEnd();
          expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(false);
        },
        { discrete: true }
      );
      expect(event.defaultPrevented).toBe(false);
    }
  );
});

describe('quote clipboard insertion', () => {
  it.each([false, true])(
    'keeps pasted paragraphs quoted for backward=%s',
    (backward) => {
      const { editor, root } = behaviorEditor(
        registerRichText,
        markdownPastePlugin()
      );
      editor.update(
        () => {
          const text = $createTextNode('replace');
          $getRoot().append($createQuoteNode().append(text));
          text.select(backward ? 7 : 0, backward ? 0 : 7);
          const selection = $getSelection();
          if (!$isRangeSelection(selection))
            throw new Error('Expected clipboard range');
          $insertGeneratedNodes(
            editor,
            [
              $createParagraphNode().append($createTextNode('first')),
              $createParagraphNode().append(
                $createTextNode('second').toggleFormat('bold')
              ),
            ],
            selection
          );
        },
        { discrete: true }
      );
      expect([...root.children].map((element) => element.tagName)).toEqual([
        'BLOCKQUOTE',
        'BLOCKQUOTE',
      ]);
      expect(root.children[0].textContent).toBe('first');
      expect(root.children[1].textContent).toBe('second');
      expect(root.querySelector('strong')?.textContent).toBe('second');
    }
  );
});
