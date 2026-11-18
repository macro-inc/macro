import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import { BookingLinkMentionNode } from '@macro-inc/lexical-core/nodes/BookingLinkMentionNode';
import { DateMentionNode } from '@macro-inc/lexical-core/nodes/DateMentionNode';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  createEditor,
  HISTORY_PUSH_TAG,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  INSERT_AGENT_SESSION_MENTION_COMMAND,
  INSERT_BOOKING_LINK_MENTION_COMMAND,
  INSERT_CONTACT_MENTION_COMMAND,
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_GROUP_MENTION_COMMAND,
  INSERT_PR_MENTION_COMMAND,
  INSERT_THEME_MENTION_COMMAND,
  INSERT_USER_MENTION_COMMAND,
  mentionsPlugin,
  UPDATE_DOCUMENT_NAME_COMMAND,
  UPDATE_USER_DISPLAY_NAME_COMMAND,
} from '../plugins/mentions/mentionsPlugin';
import { behaviorEditor } from './editor';

// The imported tracking service opens a transport on load. Keep this fixture
// offline while exercising actual editor commands, nodes and serialization.
vi.hoisted(() => {
  vi.stubGlobal(
    'WebSocket',
    class {
      readyState = 1;
      close() {}
      addEventListener() {}
      removeEventListener() {}
      send() {}
    }
  );
});

const INSERTIONS = [
  {
    name: 'document',
    type: 'document-mention',
    fields: { documentId: 'document', mentionUuid: 'reference' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
        documentId: 'document',
        documentName: 'Reference',
        blockName: 'md',
        mentionUuid: 'reference',
      }),
  },
  {
    name: 'document agent',
    type: 'agent-session-mention',
    fields: { id: 'session', label: 'Session' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
        documentId: 'session',
        documentName: 'Session',
        blockName: 'agent',
      }),
  },
  {
    name: 'user',
    type: 'user-mention',
    fields: { userId: 'user', mentionUuid: 'reference' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
        userId: 'user',
        email: 'user@example.com',
        displayName: 'Reader',
        mentionUuid: 'reference',
      }),
  },
  {
    name: 'contact',
    type: 'contact-mention',
    fields: { contactId: 'contact', mentionUuid: 'reference' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_CONTACT_MENTION_COMMAND, {
        contactId: 'contact',
        name: 'Contact',
        emailOrDomain: 'example.com',
        isCompany: false,
        mentionUuid: 'reference',
      }),
  },
  {
    name: 'date',
    type: 'date-mention',
    fields: { date: '2025-01-01T12:00:00.000Z', mentionUuid: 'reference' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
        date: '2025-01-01T12:00:00.000Z',
        displayFormat: 'January 1, 2025',
        mentionUuid: 'reference',
      }),
  },
  {
    name: 'group',
    type: 'group-mention',
    fields: { groupAlias: 'team' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_GROUP_MENTION_COMMAND, {
        groupAlias: 'team',
      }),
  },
  {
    name: 'agent session',
    type: 'agent-session-mention',
    fields: { id: 'session', mentionUuid: 'reference' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_AGENT_SESSION_MENTION_COMMAND, {
        id: 'session',
        label: 'Session',
        mentionUuid: 'reference',
      }),
  },
  {
    name: 'pull request',
    type: 'pr-mention',
    fields: { id: 'request', mentionUuid: 'reference' },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_PR_MENTION_COMMAND, {
        id: 'request',
        label: 'Change',
        mentionUuid: 'reference',
      }),
  },
  {
    name: 'theme',
    type: 'theme-mention',
    fields: { name: 'Palette', data: { version: 1 } },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_THEME_MENTION_COMMAND, {
        name: 'Palette',
        data: { version: 1 },
      }),
  },
  {
    name: 'booking link',
    type: 'booking-link-mention',
    fields: {
      profileId: 'profile',
      slug: 'meeting',
      url: 'https://example.com/meeting',
    },
    insert: (editor: LexicalEditor) =>
      editor.dispatchCommand(INSERT_BOOKING_LINK_MENTION_COMMAND, {
        profileId: 'profile',
        slug: 'meeting',
        label: 'Meeting',
        url: 'https://example.com/meeting',
      }),
  },
] as const;

for (const empty of [true, false]) {
  describe(`mention command insertion (empty=${empty})`, () => {
    it.each(INSERTIONS)(
      '$name inserts its real node, payload and paragraph boundary',
      ({ type, fields, insert }) => {
        const { editor } = behaviorEditor(mentionsPlugin({}));
        editor.update(
          () => {
            if (empty) $getRoot().select(0, 0);
            else {
              const text = $createTextNode('left right');
              $getRoot().append($createParagraphNode().append(text));
              text.select(5, 5);
            }
            expect(insert(editor)).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          const paragraph = $getRoot().getFirstChild();
          expect($getRoot().getChildren()).toHaveLength(1);
          expect(paragraph?.getType()).toBe('paragraph');
          if (!$isElementNode(paragraph))
            throw new Error('Expected wrapping paragraph');
          const mentions = paragraph
            .getChildren()
            .filter((node) => node.getType() === type);
          expect(mentions).toHaveLength(1);
          expect(mentions[0].exportJSON()).toMatchObject({ type, ...fields });
          if (!empty)
            expect(
              paragraph
                .getChildren()
                .filter($isTextNode)
                .map((node) => node.getTextContent())
            ).toEqual(['left ', 'right']);
        });
      }
    );
  });
}

for (const backward of [true, false]) {
  describe(`mention append preserves a range (backward=${backward})`, () => {
    it.each(
      INSERTIONS.filter(
        (entry) => entry.name === 'document' || entry.name === 'theme'
      )
    )(
      '$name appends after selected text without replacing it',
      ({ type, insert }) => {
        const { editor } = behaviorEditor(mentionsPlugin({}));
        editor.update(
          () => {
            const text = $createTextNode('before selected after');
            $getRoot().append($createParagraphNode().append(text));
            text.select(backward ? 15 : 7, backward ? 7 : 15);
            expect(insert(editor)).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
          expect(
            paragraph
              .getChildren()
              .filter($isTextNode)
              .map((node) => node.getTextContent())
          ).toEqual(['before selected ', ' after']);
          expect(
            paragraph.getChildren().filter((node) => node.getType() === type)
          ).toHaveLength(1);
        });
      }
    );
  });
}

for (const key of ['Backspace', 'Delete']) {
  describe(`selected tracked mention ${key}`, () => {
    it.each(
      INSERTIONS.filter(
        (entry) => entry.name !== 'theme' && entry.name !== 'booking link'
      )
    )('$name removes only the selected mention', ({ type, insert }) => {
      const { editor } = behaviorEditor(mentionsPlugin({}));
      editor.update(
        () => {
          const text = $createTextNode('left right');
          $getRoot().append($createParagraphNode().append(text));
          text.select(5, 5);
          insert(editor);
        },
        { discrete: true }
      );
      editor.update(
        () => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
          const mention = paragraph
            .getChildren()
            .find((node) => node.getType() === type);
          if (!mention) throw new Error('Expected inserted mention');
          const selection = $createNodeSelection();
          selection.add(mention.getKey());
          $setSelection(selection);
          expect(
            editor.dispatchCommand(
              key === 'Backspace' ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND,
              new KeyboardEvent('keydown', { key })
            )
          ).toBe(true);
        },
        { discrete: true }
      );
      editor.read(() => {
        expect($getRoot().getTextContent()).toBe('left right');
        expect(
          $getRoot()
            .getAllTextNodes()
            .map((node) => node.getType())
        ).toEqual(['text']);
      });
    });
  });
}

describe('remote mention labels and local undo', () => {
  it.each(
    INSERTIONS.filter(
      (entry) => entry.name === 'document' || entry.name === 'user'
    )
  )(
    '$name label updates do not become a separate undo step',
    ({ name, type, insert }) => {
      const { editor } = behaviorEditor(mentionsPlugin({}));
      const dispose = registerHistory(editor, createEmptyHistoryState(), 400);
      try {
        editor.update(
          () => {
            const text = $createTextNode('left right');
            $getRoot().append($createParagraphNode().append(text));
            text.select(5, 5);
            insert(editor);
          },
          { discrete: true }
        );
        editor.update(
          () => {
            $getRoot().getAllTextNodes().at(-1)?.setTextContent('changed');
          },
          { discrete: true, tag: HISTORY_PUSH_TAG }
        );
        editor.dispatchCommand(
          name === 'document'
            ? UPDATE_DOCUMENT_NAME_COMMAND
            : UPDATE_USER_DISPLAY_NAME_COMMAND,
          { [name]: 'Updated' }
        );
        editor.read(() => {
          const paragraph = $getRoot().getFirstChild();
          if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
          const mention = paragraph
            .getChildren()
            .find((node) => node.getType() === type);
          expect(mention?.exportJSON()).toMatchObject(
            name === 'document'
              ? { documentName: 'Updated' }
              : { displayName: 'Updated' }
          );
        });
        editor.dispatchCommand(UNDO_COMMAND, undefined);
        editor.read(() =>
          expect(
            $getRoot()
              .getAllTextNodes()
              .map((node) => node.getTextContent())
              .join('')
          ).toBe('left right')
        );
        editor.dispatchCommand(REDO_COMMAND, undefined);
        editor.read(() =>
          expect(
            $getRoot()
              .getAllTextNodes()
              .map((node) => node.getTextContent())
              .join('')
          ).toBe('left changed')
        );
      } finally {
        dispose();
      }
    }
  );
});

describe('mention node dependencies', () => {
  it('rejects registration when a required date node is absent', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes.filter((node) => node !== DateMentionNode),
    });
    expect(() => mentionsPlugin({})(editor)).toThrow(
      'MentionsPlugin: Editor config is missing required nodes.'
    );
  });

  it('yields booking-link insertion when its optional node is absent', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes.filter(
        (node) => node !== BookingLinkMentionNode
      ),
    });
    editor.setRootElement(document.createElement('div'));
    const dispose = mentionsPlugin({})(editor);
    try {
      editor.update(
        () => {
          const text = $createTextNode('retained');
          $getRoot().append($createParagraphNode().append(text));
          text.select(4, 4);
        },
        { discrete: true }
      );
      const before = editor.getEditorState().toJSON();
      expect(
        editor.dispatchCommand(INSERT_BOOKING_LINK_MENTION_COMMAND, {
          profileId: 'profile',
          url: 'https://example.com/meeting',
        })
      ).toBe(false);
      editor.read(() => expect($getRoot().getTextContent()).toBe('retained'));
      expect(editor.getEditorState().toJSON()).toEqual(before);
    } finally {
      dispose();
      editor.setRootElement(null);
    }
  });
});
