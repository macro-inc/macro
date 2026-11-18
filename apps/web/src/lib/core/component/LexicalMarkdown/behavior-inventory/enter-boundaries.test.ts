import {
  $createHeadingNode,
  $createQuoteNode,
  registerRichText,
} from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeEnterPlugin } from '../plugins/normalize-enter/normalizeEnterPlugin';
import { behaviorEditor } from './editor';

afterEach(() => vi.useRealTimers());

describe('heading Enter boundaries', () => {
  it.each(['h1', 'h2', 'h3'] as const)(
    'empty %s exits to a paragraph',
    (tag) => {
      const { editor } = behaviorEditor(
        registerRichText,
        normalizeEnterPlugin()
      );
      editor.update(
        () => {
          const heading = $createHeadingNode(tag);
          $getRoot().append(heading);
          heading.selectStart();
          editor.dispatchCommand(
            KEY_ENTER_COMMAND,
            new KeyboardEvent('keydown', { key: 'Enter' })
          );
        },
        { discrete: true }
      );
      editor.read(() =>
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getType())
        ).toEqual(['paragraph'])
      );
    }
  );

  it.each([
    { anchor: 1, focus: 3 },
    { anchor: 3, focus: 1 },
  ])(
    'Enter replaces selected heading text at $anchor,$focus',
    ({ anchor, focus }) => {
      const { editor } = behaviorEditor(
        registerRichText,
        normalizeEnterPlugin()
      );
      editor.update(
        () => {
          const text = $createTextNode('abcd');
          $getRoot().append($createHeadingNode('h2').append(text));
          text.select(anchor, focus);
          editor.dispatchCommand(
            KEY_ENTER_COMMAND,
            new KeyboardEvent('keydown', { key: 'Enter' })
          );
        },
        { discrete: true }
      );
      editor.read(() => {
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getType())
        ).toEqual(['heading', 'paragraph']);
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getTextContent())
        ).toEqual(['a', 'd']);
        const selection = $getSelection();
        expect($isRangeSelection(selection) && selection.isCollapsed()).toBe(
          true
        );
      });
    }
  );

  for (const tag of ['h1', 'h2', 'h3'] as const) {
    it.each([0, 2, 4])(
      `${tag} Enter at offset %s preserves the split content and block types`,
      (offset) => {
        const { editor } = behaviorEditor(
          registerRichText,
          normalizeEnterPlugin()
        );
        editor.update(
          () => {
            const text = $createTextNode('abcd');
            $getRoot().append($createHeadingNode(tag).append(text));
            text.select(offset, offset);
            expect(
              editor.dispatchCommand(
                KEY_ENTER_COMMAND,
                new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
              )
            ).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          const children = $getRoot().getChildren();
          expect(children.map((node) => node.getType())).toEqual(
            offset === 0 ? ['paragraph', 'heading'] : ['heading', 'paragraph']
          );
          expect(children.map((node) => node.getTextContent())).toEqual(
            offset === 0
              ? ['', 'abcd']
              : ['abcd'.slice(0, offset), 'abcd'.slice(offset)]
          );
        });
      }
    );
  }
});

describe('modified Enter propagation', () => {
  it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])(
    'normalization yields %s in a nonempty heading',
    (modifier) => {
      const { editor } = behaviorEditor(normalizeEnterPlugin());
      editor.update(
        () => {
          const text = $createTextNode('heading');
          $getRoot().append($createHeadingNode('h2').append(text));
          text.select(3, 3);
          const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            [modifier]: true,
            cancelable: true,
          });
          expect(editor.dispatchCommand(KEY_ENTER_COMMAND, event)).toBe(false);
          expect(event.defaultPrevented).toBe(false);
        },
        { discrete: true }
      );
      editor.read(() =>
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getTextContent())
        ).toEqual(['heading'])
      );
    }
  );
});

describe('quote and paragraph Enter boundaries', () => {
  it.each(['', 'quote'])('Enter at quote start handles %j content', (value) => {
    const { editor } = behaviorEditor(registerRichText, normalizeEnterPlugin());
    editor.update(
      () => {
        const quote = $createQuoteNode();
        $getRoot().append(quote);
        if (value) {
          const text = $createTextNode(value);
          quote.append(text);
          text.select(0, 0);
        } else quote.selectStart();
        editor.dispatchCommand(
          KEY_ENTER_COMMAND,
          new KeyboardEvent('keydown', { key: 'Enter' })
        );
      },
      { discrete: true }
    );
    editor.read(() => {
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType())
      ).toEqual(value ? ['quote', 'quote'] : ['paragraph']);
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getTextContent())
      ).toEqual(value ? ['', 'quote'] : ['']);
    });
  });

  it('ShiftEnter in an empty paragraph creates a paragraph rather than a line break', () => {
    const { editor, root } = behaviorEditor(
      registerRichText,
      normalizeEnterPlugin()
    );
    editor.update(
      () => {
        $getRoot().append($createParagraphNode()).selectStart();
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: true,
          cancelable: true,
        });
        expect(editor.dispatchCommand(KEY_ENTER_COMMAND, event)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
      },
      { discrete: true }
    );
    editor.read(() =>
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType())
      ).toEqual(['paragraph', 'paragraph'])
    );
    expect(root.children).toHaveLength(2);
  });

  it('ShiftEnter in nonempty text retains ordinary line-break behavior', () => {
    const { editor } = behaviorEditor(registerRichText, normalizeEnterPlugin());
    editor.update(
      () => {
        const text = $createTextNode('text');
        $getRoot().append($createParagraphNode().append(text));
        text.select(0, 0);
        editor.dispatchCommand(
          KEY_ENTER_COMMAND,
          new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })
        );
      },
      { discrete: true }
    );
    editor.read(() =>
      expect($getRoot().getFirstChild()?.getTextContent()).toBe('\ntext')
    );
  });

  it('retains inherited format and style with the production node registry', async () => {
    vi.useFakeTimers();
    const { editor } = behaviorEditor(registerRichText, normalizeEnterPlugin());
    editor.update(
      () => {
        const text = $createTextNode('Hello').setFormat('bold');
        const paragraph = $createParagraphNode().append(text);
        $getRoot().append(paragraph);
        const selection = text.select(5, 5);
        selection.setFormat(text.getFormat());
        selection.setStyle('color: red;');
      },
      { discrete: true }
    );
    editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' })
    );
    await vi.advanceTimersByTimeAsync(1);
    editor.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection))
        throw new Error('Expected typing selection');
      expect(selection.format).toBe(1);
      expect(selection.style).toBe('color: red;');
    });
    editor.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection))
          throw new Error('Expected typing selection');
        selection.insertText('plain');
      },
      { discrete: true }
    );
    editor.read(() => {
      const text = $getRoot().getAllTextNodes().at(-1);
      expect(text?.getTextContent()).toBe('plain');
      expect(text?.getFormat()).toBe(1);
      expect(text?.getStyle()).toBe('color: red;');
    });
  });
});
