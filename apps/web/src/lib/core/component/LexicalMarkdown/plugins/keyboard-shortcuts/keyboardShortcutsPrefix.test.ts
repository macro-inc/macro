import { IS_MAC } from '@core/constant/isMac';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  FORMAT_TEXT_COMMAND,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  DefaultShortcuts,
  keyboardShortcutsPlugin,
} from './keyboardShortcutsPlugin';

// Synthetic DOM command-boundary control, not a trusted browser default-action proof.
test('actual Source shortcut prefix survives a nested Format error in the same DOM dispatch', () => {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  const errors: unknown[] = [];
  const editor = createEditor({
    namespace: 'source-shortcut-prefix',
    nodes: [ParagraphNode, TextNode],
    onError: (error) => {
      errors.push(error);
    },
  });
  const dispose: (() => void)[] = [];
  let primary: { readonly error: unknown } | undefined;
  const marker = new Error('injected nested Format error');
  let fail = true;
  let formats = 0;
  let documentCalls = 0;
  const returned: boolean[] = [];
  const documentListener = () => {
    documentCalls++;
  };
  const rootListener = (event: KeyboardEvent) => {
    returned.push(event.defaultPrevented);
  };
  const failures: { readonly error: unknown }[] = [];
  try {
    editor.setRootElement(root); // Installs the actual Source root keydown listener first.
    dispose.push(
      keyboardShortcutsPlugin({ shortcuts: DefaultShortcuts })(editor)
    );
    dispose.push(
      editor.registerCommand(
        FORMAT_TEXT_COMMAND,
        (format) => {
          // Like the production FORMAT listeners, the callback receives only format,
          // not the DOM event; it reads no event flags between prefix and throw.
          expect(format).toBe('code');
          formats++;
          if (fail) throw marker;
          return true;
        },
        COMMAND_PRIORITY_HIGH
      )
    );
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('before');
        paragraph.append(text);
        $getRoot().clear().append(paragraph);
        text.select(6, 6);
      },
      { discrete: true }
    );
    root.addEventListener('keydown', rootListener);
    document.addEventListener('keydown', documentListener);
    const before = editor.getEditorState().toJSON();
    const event = new KeyboardEvent('keydown', {
      key: 'e',
      code: 'KeyE',
      ctrlKey: !IS_MAC,
      metaKey: IS_MAC,
      bubbles: true,
      cancelable: true,
    });
    expect(root.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(returned).toEqual([true]);
    expect(documentCalls).toBe(0);
    expect(formats).toBe(1);
    expect(errors).toEqual([marker]);
    expect(editor.getEditorState().toJSON()).toEqual(before);
    fail = false;
    const next = new KeyboardEvent('keydown', {
      key: 'e',
      code: 'KeyE',
      ctrlKey: !IS_MAC,
      metaKey: IS_MAC,
      bubbles: true,
      cancelable: true,
    });
    expect(root.dispatchEvent(next)).toBe(false);
    expect(returned).toEqual([true, true]);
    expect(documentCalls).toBe(0);
    expect(formats).toBe(2);
    expect(errors).toEqual([marker]);
  } catch (error) {
    primary = { error };
    throw error;
  } finally {
    const cleanup = (call: () => void) => {
      try {
        call();
      } catch (error) {
        failures.push({ error });
      }
    };
    cleanup(() => document.removeEventListener('keydown', documentListener));
    cleanup(() => root.removeEventListener('keydown', rootListener));
    for (const release of dispose.reverse()) cleanup(release);
    cleanup(() => editor.setRootElement(null));
    cleanup(() => root.remove());
  }
  if (!primary && failures.length) throw failures[0].error;
});
