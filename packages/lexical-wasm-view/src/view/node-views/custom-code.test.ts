/** @vitest-environment jsdom */
// Source: @lexical/code-core 0.45 CodeNode.createDOM/updateDOM and Macro
// CustomCodeNode.createDOM/updateDOM (packages/lexical-core/nodes/CustomCodeNode.ts).
import {
  Access,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test } from 'vitest';
import { selectionMessage } from '../session-port';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';

beforeAll(initializeNativeSurfaceTests);

const THEME = { code: 'block code-surface' };

function load(
  fixture: ReturnType<typeof nativeSurface>,
  code: Record<string, unknown>
) {
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'custom-code',
            version: 1,
            ...code,
            children: [{ type: 'text', version: 1, text: 'const value = 1;' }],
          },
        ],
      },
    })
  );
  const element = fixture.root.querySelector('code');
  const node = [...fixture.view.mirror.values()].find(
    (candidate) => candidate.type === 'custom-code'
  );
  if (!element || !node) throw new Error('Missing native code block');
  return { element, key: node.key };
}

function codeAction(
  fixture: ReturnType<typeof nativeSurface>,
  payload: Record<string, unknown>
) {
  const generation = fixture.view.mirror.keyGeneration;
  if (generation === null) throw new Error('Missing native generation');
  fixture.port.input(
    EditorInputMsg.fromEditorApplication({
      name: 'group-b.code',
      json: JSON.stringify(payload),
      generation,
      selection: selectionMessage({ kind: 'keep' }),
      keyboard: false,
      key: '',
      mods: 0,
      code: 0,
    })
  );
}

test('creates the Source code element attributes in Source order', () => {
  const fixture = nativeSurface(Access.Edit, THEME);
  try {
    const { element } = load(fixture, { language: 'javascript' });
    expect(element.getAttributeNames()).toEqual([
      'class',
      'spellcheck',
      'data-language',
      'dir',
    ]);
    expect(element.className).toBe('block code-surface');
    expect(element.getAttribute('spellcheck')).toBe('false');
    expect(element.getAttribute('data-language')).toBe('javascript');
    expect(element.getAttribute('dir')).toBe('auto');
  } finally {
    fixture.close();
  }
});

test('omits data-language for an unset language', () => {
  const fixture = nativeSurface(Access.Edit, THEME);
  try {
    const { element } = load(fixture, {});
    expect(element.hasAttribute('data-language')).toBe(false);
    expect(element.hasAttribute('style')).toBe(false);
  } finally {
    fixture.close();
  }
});

test('creates an SVG preview block as non-editable preview mode', () => {
  const fixture = nativeSurface(Access.Edit, THEME);
  try {
    const { element } = load(fixture, {
      language: 'svg',
      previewEnabled: true,
    });
    expect(element.classList.contains('preview-mode')).toBe(true);
    expect(element.getAttribute('contenteditable')).toBe('false');
  } finally {
    fixture.close();
  }
});

test('updates language and preview in place, keeping foreign classes', () => {
  const fixture = nativeSurface(Access.Edit, THEME);
  try {
    const { element, key } = load(fixture, { language: 'svg' });
    element.classList.add('__accessory-code-box');
    codeAction(fixture, { action: 'preview', key, enabled: true });
    expect(fixture.root.querySelector('code')).toBe(element);
    expect(element.classList.contains('preview-mode')).toBe(true);
    expect(element.getAttribute('contenteditable')).toBe('false');
    codeAction(fixture, { action: 'preview', key, enabled: false });
    expect(element.classList.contains('preview-mode')).toBe(false);
    expect(element.getAttribute('contenteditable')).toBe('true');
    codeAction(fixture, { action: 'language', key, language: 'python' });
    expect(fixture.root.querySelector('code')).toBe(element);
    expect(element.getAttribute('data-language')).toBe('python');
    expect(element.classList.contains('__accessory-code-box')).toBe(true);
  } finally {
    fixture.close();
  }
});
