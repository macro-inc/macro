import { writeFileSync } from 'node:fs';
import type { BlockName } from '@core/block';
import type { IUser } from '@core/user';
import { InlineSearchNode, UserMentionNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
} from 'lexical';
import { beforeEach, expect, test, vi } from 'vitest';
import { createLexicalMentionMenuHost } from '../editing/overlay-hosts/lexical-mentions';
import {
  INSERT_USER_MENTION_COMMAND,
  mentionsPlugin,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../plugins/mentions/mentionsPlugin';
import {
  createMenuOperations,
  type MenuOperations,
} from '../shared/inlineMenu';
import {
  handleUserMention,
  type UserMentionRecord,
} from '../utils/mentionsUtils';
import { behaviorEditor } from './editor';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
// Only transport and entropy are controlled; editor, nodes and commands are real.
vi.mock('@core/signal/mention', async (original) => ({
  ...(await original<typeof import('@core/signal/mention')>()),
  trackMention,
}));
vi.mock('uuid', async (original) => ({
  ...(await original<typeof import('uuid')>()),
  v7: () => '00000000-0000-7000-8000-000000000001',
}));
const user: IUser = {
  id: 'fixture-user',
  email: 'person@example.com',
  name: ' Person Name ',
};
beforeEach(() => {
  trackMention.mockReset();
});

function capture(editor: LexicalEditor, name: string, events: string[]) {
  const raw = editor.read(() => {
    const selection = $getSelection();
    return {
      events,
      json: editor.getEditorState().toJSON(),
      text: $getRoot().getTextContent(),
      selection: $isRangeSelection(selection)
        ? {
            anchor: selection.anchor,
            focus: selection.focus,
            format: selection.format,
            style: selection.style,
          }
        : null,
    };
  });
  const directory = process.env.SOURCE_USER_MENTION_IO_OUTPUT;
  if (directory)
    writeFileSync(`${directory}/${name}.json`, JSON.stringify(raw, null, 2));
  return raw;
}
function fixture(events: string[], menu?: MenuOperations) {
  const actual = behaviorEditor(mentionsPlugin({ menu }));
  actual.editor.update(
    () => {
      $getRoot()
        .append($createParagraphNode().append($createTextNode('body')))
        .selectEnd();
    },
    { discrete: true }
  );
  actual.editor.registerCommand(
    INSERT_USER_MENTION_COMMAND,
    () => {
      events.push('insert');
      return false;
    },
    COMMAND_PRIORITY_HIGH
  );
  return actual;
}

test('Source no-tracking insertion notifies and dispatches before returning its promise', async () => {
  const events: string[] = [];
  const { editor } = fixture(events);
  const records: UserMentionRecord[] = [];
  const pending = handleUserMention(user, {
    editor,
    blockName: 'md',
    blockId: 'source-document',
    disableMentionTracking: true,
    onUserMention(record) {
      events.push('record');
      records.push(record);
    },
  });
  expect(events).toEqual(['record', 'insert']);
  expect(trackMention).not.toHaveBeenCalled();
  expect(records).toEqual([
    {
      documentId: 'source-document',
      mentions: ['fixture-user'],
      email: 'person@example.com',
      metadata: { mention_id: '00000000-0000-7000-8000-000000000001' },
    },
  ]);
  expect(capture(editor, 'disabled-tracking', events).text).toBe('body@Person');
  await pending;
});

test('Source channel insertion skips notification and tracking without delaying insertion', async () => {
  const events: string[] = [];
  const { editor } = fixture(events);
  const pending = handleUserMention(user, {
    editor,
    blockName: 'channel',
    blockId: 'source-channel',
    onUserMention: () => events.push('record'),
  });
  expect(events).toEqual(['insert']);
  expect(trackMention).not.toHaveBeenCalled();
  expect(capture(editor, 'channel', events).text).toBe('body@Person');
  await pending;
});

test.each(['issued-mention', undefined])(
  'Source awaits tracking then inserts %s at the current caret',
  async (uuid) => {
    const events: string[] = [];
    const { editor } = fixture(events);
    const tracking = Promise.withResolvers<string | undefined>();
    trackMention.mockImplementation(() => {
      events.push('track');
      return tracking.promise;
    });
    const pending = handleUserMention(user, {
      editor,
      blockName: 'md',
      blockId: 'source-document',
      onUserMention: () => events.push('record'),
    });
    expect(events).toEqual(['record', 'track']);
    expect(trackMention).toHaveBeenCalledWith(
      'source-document',
      'user',
      'fixture-user'
    );
    editor.update(
      () => {
        $getRoot()
          .append($createParagraphNode().append($createTextNode('later')))
          .selectEnd();
      },
      { discrete: true }
    );
    tracking.resolve(uuid);
    await pending;
    expect(events).toEqual(['record', 'track', 'insert']);
    expect(capture(editor, `tracked-${uuid ?? 'missing'}`, events).text).toBe(
      'body\n\nlater@Person'
    );
    editor.read(() =>
      expect($nodesOfType(UserMentionNode)[0].getMentionUuid()).toBe(uuid)
    );
  }
);

test.each([null, undefined, { opaque: true }])(
  'Source retains opaque notification throw %j before tracking/insertion',
  async (failure) => {
    const events: string[] = [];
    const { editor } = fixture(events);
    const pending = handleUserMention(user, {
      editor,
      blockId: 'source-document',
      onUserMention() {
        events.push('record');
        throw failure;
      },
    });
    await expect(pending).rejects.toBe(failure);
    expect(events).toEqual(['record']);
    expect(trackMention).not.toHaveBeenCalled();
    editor.read(() => expect($nodesOfType(UserMentionNode)).toHaveLength(0));
  }
);

test.each([null, undefined, { opaque: true }])(
  'Source retains opaque tracking rejection %j without insertion',
  async (failure) => {
    const events: string[] = [];
    const { editor } = fixture(events);
    trackMention.mockRejectedValue(failure);
    await expect(
      handleUserMention(user, { editor, blockId: 'source-document' })
    ).rejects.toBe(failure);
    expect(events).toEqual([]);
    editor.read(() => expect($nodesOfType(UserMentionNode)).toHaveLength(0));
  }
);

test('Source removes search before tracking and menu close does not cancel the pending insertion', async () => {
  const events: string[] = [];
  const menu = createMenuOperations();
  const { editor, root } = fixture(events, menu);
  editor.update(
    () => $getRoot().clear().append($createParagraphNode()).selectEnd(),
    { discrete: true }
  );
  editor.registerCommand(
    REMOVE_INLINE_SEARCH_COMMAND,
    () => {
      events.push('remove');
      return false;
    },
    4
  );
  root.dispatchEvent(new KeyboardEvent('keydown', { key: '@' }));
  editor.read(() => expect($nodesOfType(InlineSearchNode)).toHaveLength(1));
  const tracking = Promise.withResolvers<string | undefined>();
  trackMention.mockImplementation(() => {
    events.push('track');
    return tracking.promise;
  });
  const host = createLexicalMentionMenuHost(() => editor, {
    editor,
    blockName: 'md',
    blockId: 'source-document',
  });
  const pending = host.select({
    kind: 'user',
    bucket: 'person',
    id: user.id,
    data: user,
    searchText: user.name,
    sortTimestamp: 0,
    timestamps: {},
  });
  expect(events).toEqual(['remove', 'track']);
  editor.read(() => expect($nodesOfType(InlineSearchNode)).toHaveLength(0));
  expect(menu.isOpen()).toBe(false);
  host.closeSearch();
  menu.setSearchTerm('');
  menu.setIsOpen(false);
  tracking.resolve('issued-mention');
  await pending;
  expect(events).toEqual(['remove', 'track', 'insert']);
  expect(capture(editor, 'close-during-tracking', events).text).toBe('@Person');
});

test('Source reads insertion dependencies once in original order before notification', async () => {
  const events: string[] = [];
  const { editor } = fixture(events);
  const pending = handleUserMention(user, {
    get editor() {
      events.push('editor');
      return editor;
    },
    get blockName(): BlockName {
      events.push('blockName');
      return 'md';
    },
    get blockId() {
      events.push('blockId');
      return 'source-document';
    },
    get onUserMention() {
      events.push('onUserMention');
      return () => {
        events.push('record');
      };
    },
    get disableMentionTracking() {
      events.push('disableMentionTracking');
      return true;
    },
  });
  expect(events).toEqual([
    'editor',
    'blockName',
    'blockId',
    'onUserMention',
    'disableMentionTracking',
    'record',
    'insert',
  ]);
  await pending;
});

test.each([null, undefined, { opaque: true }])(
  'Source editor getter throw %j becomes rejection without synchronous throw',
  async (failure) => {
    const pending = handleUserMention(user, {
      get editor(): LexicalEditor {
        throw failure;
      },
    });
    await expect(pending).rejects.toBe(failure);
    expect(trackMention).not.toHaveBeenCalled();
  }
);

test('Source looks up actual dispatchCommand before evaluating user payload getters', async () => {
  const events: string[] = [];
  const { editor } = fixture(events);
  const original = editor.dispatchCommand;
  const descriptor = Object.getOwnPropertyDescriptor(editor, 'dispatchCommand');
  Object.defineProperty(editor, 'dispatchCommand', {
    configurable: true,
    get() {
      events.push('dispatch-get');
      return original;
    },
  });
  try {
    const observedUser: IUser = {
      get id() {
        events.push('id');
        return user.id;
      },
      get email() {
        events.push('email');
        return user.email;
      },
      get name() {
        events.push('name');
        return user.name;
      },
    };
    const pending = handleUserMention(observedUser, {
      editor,
      blockName: 'channel',
    });
    expect(events).toEqual([
      'dispatch-get',
      'id',
      'email',
      'name',
      'email',
      'insert',
    ]);
    await pending;
    capture(editor, 'dispatch-before-payload', events);
  } finally {
    if (descriptor)
      Object.defineProperty(editor, 'dispatchCommand', descriptor);
    else Reflect.deleteProperty(editor, 'dispatchCommand');
  }
});

test.each([null, undefined, { opaque: true }])(
  'Source dispatch getter throw %j precedes every payload getter',
  async (failure) => {
    const events: string[] = [];
    const { editor } = fixture(events);
    const descriptor = Object.getOwnPropertyDescriptor(
      editor,
      'dispatchCommand'
    );
    Object.defineProperty(editor, 'dispatchCommand', {
      configurable: true,
      get() {
        events.push('dispatch-get');
        throw failure;
      },
    });
    try {
      const observedUser: IUser = {
        get id() {
          events.push('id');
          return user.id;
        },
        get email() {
          events.push('email');
          return user.email;
        },
        get name() {
          events.push('name');
          return user.name;
        },
      };
      const pending = handleUserMention(observedUser, {
        editor,
        blockName: 'channel',
      });
      await expect(pending).rejects.toBe(failure);
      expect(events).toEqual(['dispatch-get']);
    } finally {
      if (descriptor)
        Object.defineProperty(editor, 'dispatchCommand', descriptor);
      else Reflect.deleteProperty(editor, 'dispatchCommand');
    }
  }
);
