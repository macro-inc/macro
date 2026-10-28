import { registerRichText } from '@lexical/rich-text';
import { InlineSearchNode } from '@macro-inc/lexical-core';
import { $createParagraphNode, $getRoot, createEditor } from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';
import { createMenuOperations } from '../../shared/inlineMenu';
import {
  agentCommandsPlugin,
  INSERT_AGENT_COMMAND_COMMAND,
  REMOVE_AGENT_COMMAND_SEARCH_COMMAND,
} from './agentCommandsPlugin';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup() {
  const editor = createEditor({
    namespace: 'agent-slash-test',
    nodes: [InlineSearchNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  const menu = createMenuOperations();
  const unregisterRichText = registerRichText(editor);
  const unregisterPlugin = agentCommandsPlugin({ menu })(editor);
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().clear().append(paragraph);
      paragraph.select();
    },
    { discrete: true }
  );
  root.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  cleanups.push(() => {
    unregisterPlugin();
    unregisterRichText();
    editor.setRootElement(null);
    root.remove();
  });
  return { editor, menu };
}

describe('agent slash trigger', () => {
  it('opens without advertised commands so skills can be selected', () => {
    const { editor, menu } = setup();
    editor.read(() => expect($getRoot().getTextContent()).toBe('/'));
    expect(menu.isOpen()).toBe(true);
  });

  it.each([null, 'instructions'])(
    'inserts commands with an argument space only when needed (%s)',
    (inputHint) => {
      const { editor } = setup();
      editor.dispatchCommand(INSERT_AGENT_COMMAND_COMMAND, {
        name: 'review',
        description: 'Review code',
        inputHint,
      });
      editor.read(() => {
        expect($getRoot().getTextContent()).toBe(
          inputHint ? '/review ' : '/review'
        );
        expect(
          $getRoot()
            .getAllTextNodes()
            .some((node) => node instanceof InlineSearchNode)
        ).toBe(false);
      });
    }
  );

  it('removes the slash search before inserting skill or PR mentions', () => {
    const { editor } = setup();
    editor.dispatchCommand(REMOVE_AGENT_COMMAND_SEARCH_COMMAND, undefined);
    editor.read(() => expect($getRoot().getTextContent()).toBe(''));
  });
});
