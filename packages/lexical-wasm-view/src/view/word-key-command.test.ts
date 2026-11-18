// @vitest-environment jsdom

import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test, vi } from 'vitest';
import { EditorSession } from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { createViewCommand, KEY_DOWN_COMMAND } from './commands';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);
const keyboard = (name: string) =>
  createViewCommand(
    name,
    (payload): payload is KeyboardEvent => payload instanceof KeyboardEvent
  );

function textSelection(fixture: ReturnType<typeof nativeSurface>) {
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'plain words' }],
          },
        ],
      },
    })
  );
  const text = [...fixture.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Missing actual text');
  fixture.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, type: 'text', offset: 6 },
    focus: { key: text.key, type: 'text', offset: 6 },
  });
  fixture.root.focus();
  const dom = fixture.view.getElementByKey(text.key)?.firstChild;
  if (!dom) throw new Error('Missing actual text DOM');
  const range = document.createRange();
  range.setStart(dom, 6);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

test.each(['ArrowLeft', 'ArrowRight'] as const)(
  'portable no-app-host %s word chord offers actual generic then matching word callbacks, never ordinary arrow callbacks',
  (key) => {
    const fixture = nativeSurface(undefined, {}, undefined, (config) =>
      EditorSession.create(ABI_MAJOR, config, 0, 0)
    );
    textSelection(fixture);
    const calls: string[] = [];
    const command = key === 'ArrowLeft' ? 'Key(MoveToStart)' : 'Key(MoveToEnd)';
    const removeGeneric = fixture.view.registerViewCommand(
      KEY_DOWN_COMMAND,
      () => {
        calls.push('generic');
        return false;
      },
      4
    );
    const removeArrow = fixture.view.registerViewCommand(
      keyboard(`Key(${key})`),
      () => {
        calls.push('wrong-arrow');
        return true;
      },
      4
    );
    const removeWord = fixture.view.registerViewCommand(
      keyboard(command),
      () => {
        calls.push('word');
        return true;
      },
      4
    );
    const before = fixture.counters.admissions;
    try {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      fixture.root.dispatchEvent(event);
      expect(calls).toEqual(['generic', 'word']);
      expect(event.defaultPrevented).toBe(true);
      expect(fixture.counters.admissions).toBe(before);
    } finally {
      removeWord();
      removeArrow();
      removeGeneric();
      fixture.close();
    }
  }
);

test('generic before handling stops matching word dispatch even without an application host', () => {
  const fixture = nativeSurface(undefined, {}, undefined, (config) =>
    EditorSession.create(ABI_MAJOR, config, 0, 0)
  );
  textSelection(fixture);
  const calls: string[] = [];
  const removeGeneric = fixture.view.registerViewCommand(
    KEY_DOWN_COMMAND,
    () => {
      calls.push('generic');
      return true;
    },
    4
  );
  const removeWord = fixture.view.registerViewCommand(
    keyboard('Key(MoveToStart)'),
    () => {
      calls.push('word');
      return true;
    },
    4
  );
  const before = fixture.counters.admissions;
  try {
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(calls).toEqual(['generic']);
    expect(fixture.counters.admissions).toBe(before);
  } finally {
    removeWord();
    removeGeneric();
    fixture.close();
  }
});

test('portable no-app-host unhandled word chord keeps the existing hot call and ordinary text model', () => {
  const fixture = nativeSurface(undefined, {}, undefined, (config) =>
    EditorSession.create(ABI_MAJOR, config, 0, 0)
  );
  textSelection(fixture);
  const call = vi.spyOn(fixture.port, 'keyDown');
  const json = fixture.session.serializedState();
  const before = fixture.counters.admissions;
  try {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fixture.root.dispatchEvent(event);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][2]).toBe(0);
    expect(call.mock.calls[0][3]).toBe('ArrowLeft');
    expect(fixture.counters.admissions).toBe(before + 1);
    expect(fixture.session.serializedState()).toBe(json);
    expect(event.defaultPrevented).toBe(false);
  } finally {
    call.mockRestore();
    fixture.close();
  }
});

test('matching word after callback runs after the actual Macro fallthrough, not under the ordinary arrow name', () => {
  const fixture = nativeSurface();
  textSelection(fixture);
  // Native High word interception exists but this fixture deliberately has no
  // application host. Its old hot Arrow decoder is unchanged by classification.
  const calls: string[] = [];
  const actual = fixture.port.keyDown.bind(fixture.port);
  const keyDown = vi
    .spyOn(fixture.port, 'keyDown')
    .mockImplementation((...args) => {
      calls.push('native');
      return actual(...args);
    });
  const generic = fixture.view.registerViewCommand(
    KEY_DOWN_COMMAND,
    () => {
      calls.push('generic');
      return false;
    },
    4
  );
  const wrong = fixture.view.registerViewCommand(
    keyboard('Key(ArrowLeft)'),
    () => {
      calls.push('wrong-arrow');
      return false;
    },
    2
  );
  const word = fixture.view.registerViewCommand(
    keyboard('Key(MoveToStart)'),
    () => {
      calls.push('word-after');
      return true;
    },
    2
  );
  try {
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fixture.root.dispatchEvent(event);
    expect(calls).toEqual(['generic', 'native', 'word-after']);
    expect(event.defaultPrevented).toBe(true);
  } finally {
    word();
    wrong();
    generic();
    keyDown.mockRestore();
    fixture.close();
  }
});
