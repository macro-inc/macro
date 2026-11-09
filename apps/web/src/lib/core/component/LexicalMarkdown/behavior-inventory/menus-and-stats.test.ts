import { $createCodeNode } from '@lexical/code';
import {
  InlineSearchNode,
  type TagMentionInfo,
  TagMentionNode,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emojisPlugin,
  REMOVE_EMOJI_SEARCH_COMMAND,
} from '../plugins/emojis/emojisPlugin';
import {
  INSERT_TAG_MENTION_COMMAND,
  tagsPlugin,
} from '../plugins/tags/tagsPlugin';
import {
  createWordcountStatsStore,
  wordcountPlugin,
} from '../plugins/wordcount/wordcountPlugin';
import { createMenuOperations } from '../shared/inlineMenu';
import { behaviorEditor } from './editor';

afterEach(() => vi.useRealTimers());

describe('emoji search lifecycle', () => {
  it.each([
    { text: '', offset: 0, opens: true },
    { text: 'word ', offset: 5, opens: true },
    { text: 'word', offset: 4, opens: false },
    { text: 'word', offset: 0, opens: false },
    { text: '`', offset: 1, opens: false },
  ])(
    'checks the caret boundary in $text at $offset',
    ({ text, offset, opens }) => {
      const menu = createMenuOperations();
      const { editor, root } = behaviorEditor(emojisPlugin({ menu }));
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          $getRoot().append(paragraph);
          if (text) {
            const node = $createTextNode(text);
            paragraph.append(node);
            node.select(offset, offset);
          } else paragraph.selectStart();
        },
        { discrete: true }
      );
      root.dispatchEvent(new KeyboardEvent('keydown', { key: ':' }));
      editor.read(() =>
        expect($nodesOfType(InlineSearchNode)).toHaveLength(Number(opens))
      );
      expect(menu.isOpen()).toBe(opens);
    }
  );

  it('does not open inside a code block', () => {
    const menu = createMenuOperations();
    const { editor, root } = behaviorEditor(emojisPlugin({ menu }));
    editor.update(
      () => {
        const text = $createTextNode(' ');
        $getRoot().append($createCodeNode().append(text));
        text.select(1, 1);
      },
      { discrete: true }
    );
    root.dispatchEvent(new KeyboardEvent('keydown', { key: ':' }));
    editor.read(() => expect($nodesOfType(InlineSearchNode)).toHaveLength(0));
    expect(menu.isOpen()).toBe(false);
  });

  it.each(['collapse', 'remove'] as const)(
    '%s closes the active search',
    (mode) => {
      const menu = createMenuOperations();
      const { editor, root } = behaviorEditor(emojisPlugin({ menu }));
      editor.update(
        () => $getRoot().append($createParagraphNode()).selectEnd(),
        { discrete: true }
      );
      root.dispatchEvent(new KeyboardEvent('keydown', { key: ':' }));
      editor.read(() => expect($nodesOfType(InlineSearchNode)).toHaveLength(1));
      expect(menu.isOpen()).toBe(true);
      editor.update(
        () => {
          if (mode === 'collapse')
            editor.dispatchCommand(
              KEY_ESCAPE_COMMAND,
              new KeyboardEvent('keydown', { key: 'Escape' })
            );
          else editor.dispatchCommand(REMOVE_EMOJI_SEARCH_COMMAND, undefined);
        },
        { discrete: true }
      );
      editor.read(() => {
        expect($nodesOfType(InlineSearchNode)).toHaveLength(0);
        expect($getRoot().getTextContent()).toBe(
          mode === 'collapse' ? ':' : ''
        );
      });
      expect(menu.isOpen()).toBe(false);
    }
  );

  it.each([true, false])(
    'Enter is consumed only while the menu is open: %s',
    (open) => {
      const menu = createMenuOperations();
      const { editor } = behaviorEditor(emojisPlugin({ menu }));
      menu.setIsOpen(open);
      expect(
        editor.dispatchCommand(
          KEY_ENTER_COMMAND,
          new KeyboardEvent('keydown', { key: 'Enter' })
        )
      ).toBe(open);
    }
  );
});

describe('tag mention insertion lifecycle', () => {
  const TAG: TagMentionInfo = {
    optionId: 'fixture-option',
    propertyDefinitionId: 'fixture-property',
    scope: 'user',
    name: 'Fixture tag',
    color: 'blue',
  };

  it('host-only titles create tags through callbacks without inserting inline nodes', () => {
    const created = vi.fn();
    const { editor } = behaviorEditor(
      tagsPlugin({ insertTags: false, onCreateTag: created })
    );
    editor.update(
      () => {
        $getRoot()
          .append($createParagraphNode().append($createTextNode('title')))
          .selectEnd();
        editor.dispatchCommand(INSERT_TAG_MENTION_COMMAND, TAG);
      },
      { discrete: true }
    );
    expect(created).toHaveBeenCalledExactlyOnceWith(TAG);
    editor.read(() => {
      expect($getRoot().getTextContent()).toBe('title');
      expect($nodesOfType(TagMentionNode)).toHaveLength(0);
    });
  });

  it('inline tags publish creation, deduplicated membership and removal', () => {
    const created = vi.fn();
    const removed = vi.fn();
    const tags = vi.fn();
    const { editor } = behaviorEditor(
      tagsPlugin({ onCreateTag: created, onRemoveTag: removed, setTags: tags })
    );
    editor.update(
      () => {
        $getRoot().append($createParagraphNode()).selectEnd();
        editor.dispatchCommand(INSERT_TAG_MENTION_COMMAND, TAG);
      },
      { discrete: true }
    );
    expect(created).toHaveBeenCalledExactlyOnceWith(TAG);
    expect(tags).toHaveBeenLastCalledWith(new Set([TAG]));
    editor.update(
      () => {
        $getRoot().selectEnd();
        editor.dispatchCommand(INSERT_TAG_MENTION_COMMAND, TAG);
      },
      { discrete: true }
    );
    editor.read(() => expect($nodesOfType(TagMentionNode)).toHaveLength(2));
    expect(tags).toHaveBeenLastCalledWith(new Set([TAG]));
    editor.update(
      () => {
        for (const node of $nodesOfType(TagMentionNode)) node.remove();
      },
      { discrete: true }
    );
    expect(removed).toHaveBeenCalledTimes(2);
    expect(tags).toHaveBeenLastCalledWith(new Set());
  });
});

describe('word and character statistics', () => {
  it.each([
    { text: 'one two', words: 2, characters: 7 },
    { text: 'hello, world!', words: 2, characters: 13 },
    { text: '  ', words: 0, characters: 2 },
    { text: 'café 😀', words: 1, characters: 7 },
  ])(
    'counts $text with the production segmenter',
    ({ text, words, characters }) => {
      vi.useFakeTimers();
      const [stats, setStore] = createWordcountStatsStore();
      const { editor } = behaviorEditor(
        wordcountPlugin({ setStore, debounceTime: 20 })
      );
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode(text))
          );
        },
        { discrete: true }
      );
      expect(stats.totalWords).toBe(0);
      vi.advanceTimersByTime(20);
      expect(stats.totalWords).toBe(words);
      expect(stats.totalCharacters).toBe(characters);
      expect(stats.selectedWords).toBeNull();
      expect(stats.selectedCharacters).toBeNull();
    }
  );

  it('counts selected text and clears selected statistics after collapsing the caret', () => {
    vi.useFakeTimers();
    const [stats, setStore] = createWordcountStatsStore();
    const { editor } = behaviorEditor(
      wordcountPlugin({ setStore, debounceTime: 20 })
    );
    editor.update(
      () => {
        const text = $createTextNode('one two');
        $getRoot().append($createParagraphNode().append(text));
        text.select(0, 3);
      },
      { discrete: true }
    );
    vi.advanceTimersByTime(20);
    expect(stats.selectedWords).toBe(1);
    expect(stats.selectedCharacters).toBe(3);
    editor.update(() => $getRoot().selectEnd(), { discrete: true });
    vi.advanceTimersByTime(20);
    expect(stats.selectedWords).toBeNull();
    expect(stats.selectedCharacters).toBeNull();
  });
});
