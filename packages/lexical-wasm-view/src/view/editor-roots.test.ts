/** @vitest-environment jsdom */
import { createEditor } from 'lexical';
import { expect, test } from 'vitest';
import {
  externalEditorRootOwner,
  registerExternalEditorRoot,
} from './editor-roots';

test('stale external-root cleanup cannot erase a newer actual editor owner', () => {
  const first = createEditor();
  const second = createEditor();
  const root = document.createElement('div');
  document.body.appendChild(root);
  first.setRootElement(root);
  const releaseFirst = registerExternalEditorRoot(root, first);
  first.setRootElement(null);
  second.setRootElement(root);
  const releaseSecond = registerExternalEditorRoot(root, second);
  try {
    releaseFirst();
    expect(externalEditorRootOwner(root)).toBe(second);
    const releaseLatest = registerExternalEditorRoot(root, second);
    releaseSecond();
    expect(externalEditorRootOwner(root)).toBe(second);
    releaseLatest();
    expect(externalEditorRootOwner(root)).toBeUndefined();
  } finally {
    second.setRootElement(null);
    releaseFirst();
    releaseSecond();
    root.remove();
  }
});

test('actual root-listener transitions and disposal release both roots', () => {
  const editor = createEditor();
  const first = document.createElement('div');
  const second = document.createElement('div');
  document.body.append(first, second);
  let releaseRoot: (() => void) | undefined;
  const releaseListener = editor.registerRootListener((root) => {
    releaseRoot?.();
    releaseRoot = root ? registerExternalEditorRoot(root, editor) : undefined;
  });
  try {
    editor.setRootElement(first);
    expect(externalEditorRootOwner(first)).toBe(editor);
    editor.setRootElement(second);
    expect(externalEditorRootOwner(first)).toBeUndefined();
    expect(externalEditorRootOwner(second)).toBe(editor);
    editor.setRootElement(null);
    expect(externalEditorRootOwner(second)).toBeUndefined();
    editor.setRootElement(first);
    releaseListener();
    releaseRoot?.();
    expect(externalEditorRootOwner(first)).toBeUndefined();
  } finally {
    editor.setRootElement(null);
    releaseListener();
    releaseRoot?.();
    first.remove();
    second.remove();
  }
});
