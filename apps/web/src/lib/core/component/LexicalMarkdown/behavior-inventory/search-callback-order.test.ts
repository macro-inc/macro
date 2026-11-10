import { writeFileSync } from 'node:fs';
import { InlineSearchNode } from '@macro-inc/lexical-core';
import {
  createPeerIdValidator,
  peerIdPlugin,
} from '@macro-inc/lexical-core/plugins/peerIdPlugin';
import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical';
import { expect, test } from 'vitest';
import { actionsPlugin } from '../plugins/actions/actionsPlugin';
import { emojisPlugin } from '../plugins/emojis/emojisPlugin';
import { mentionsPlugin } from '../plugins/mentions/mentionsPlugin';
import { snippetsPlugin } from '../plugins/snippets/snippetsPlugin';
import { createMenuOperations } from '../shared/inlineMenu';
import { behaviorEditor } from './editor';

test.each(['authored', 'local-peer', 'remote-peer', '', undefined])(
  'actual body listener order and local-status follow-up: %s',
  (owner) => {
    const events: {
      kind: string;
      callback: string;
      open: boolean;
      term: string;
    }[] = [];
    const menu = (kind: string) => {
      const actual = createMenuOperations();
      const record = (callback: string) =>
        events.push({
          kind,
          callback,
          open: actual.isOpen(),
          term: actual.searchTerm(),
        });
      return {
        ...actual,
        openMenu: () => {
          actual.openMenu();
          record('open');
        },
        closeMenu: () => {
          actual.closeMenu();
          record('close');
        },
        setSearchTerm: (term: string) => {
          actual.setSearchTerm(term);
          record('term');
        },
      };
    };
    const peerIdValidator = createPeerIdValidator(() => 'local-peer');
    const { editor, root } = behaviorEditor(
      emojisPlugin({ menu: menu('emojis'), peerIdValidator }),
      mentionsPlugin({ menu: menu('mentions'), peerIdValidator }),
      snippetsPlugin({ menu: menu('snippets'), peerIdValidator }),
      actionsPlugin({ menu: menu('actions'), peerIdValidator }),
      peerIdPlugin({ peerId: () => 'local-peer', nodes: [InlineSearchNode] })
    );
    if (owner === 'authored') {
      editor.update(
        () => $getRoot().append($createParagraphNode()).selectEnd(),
        { discrete: true }
      );
      root.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    } else {
      editor.setEditorState(
        editor.parseEditorState(
          JSON.stringify({
            root: {
              type: 'root',
              version: 1,
              children: [
                {
                  type: 'paragraph',
                  version: 1,
                  children: [
                    {
                      type: 'inline-search',
                      version: 1,
                      text: '/',
                      $: { peerId: owner },
                    },
                  ],
                },
              ],
            },
          })
        )
      );
    }
    editor.read(() => {});
    const initial = {
      events: [...events],
      json: editor.getEditorState().toJSON(),
    };
    const eligible = owner === 'authored' || owner === 'local-peer';
    const callbacks = ['emojis', 'mentions', 'snippets', 'actions'].map(
      (kind) => ({
        kind,
        callback: 'term',
        open: eligible && kind === 'actions',
        term: '',
      })
    );
    expect(initial.events).toEqual(
      eligible
        ? [
            { kind: 'actions', callback: 'open', open: true, term: '' },
            ...callbacks,
          ]
        : []
    );
    events.length = 0;
    editor.update(
      () => $nodesOfType(InlineSearchNode)[0].setTextContent('/term'),
      { discrete: true }
    );
    editor.read(() => {});
    const dirty = {
      events: [...events],
      json: editor.getEditorState().toJSON(),
    };
    const dirtyEligible = eligible || owner === undefined;
    const terms = callbacks.map((event) => ({ ...event, term: 'term' }));
    expect(dirty.events).toEqual(dirtyEligible ? terms : []);
    events.length = 0;
    editor.update(() => $nodesOfType(InlineSearchNode)[0].setFormat(1), {
      discrete: true,
    });
    editor.read(() => {});
    const formatOnly = {
      events: [...events],
      json: editor.getEditorState().toJSON(),
    };
    expect(formatOnly.events).toEqual(dirty.events);
    if (process.env.SOURCE_SEARCH_CALLBACK_OUTPUT) {
      writeFileSync(
        `${process.env.SOURCE_SEARCH_CALLBACK_OUTPUT}/${owner === '' ? 'empty' : (owner ?? 'missing')}.json`,
        JSON.stringify({ initial, dirty, formatOnly }, null, 2)
      );
    }
  }
);
