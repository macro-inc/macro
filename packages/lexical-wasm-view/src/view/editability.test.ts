/** @vitest-environment jsdom */
import { createEditor } from 'lexical';
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);
interface Editable {
  value(): boolean;
  set(value: boolean): void;
  subscribe(listener: (value: boolean) => void): () => void;
}
function transitions(editor: Editable) {
  const events: string[] = [];
  let removeLater = () => {};
  let lateRegistered = false;
  const late = (value: boolean) => {
    events.push(`late:${value}`);
  };
  editor.subscribe((value) => {
    events.push(`first:${value}:${editor.value()}`);
    removeLater();
    if (!lateRegistered) {
      lateRegistered = true;
      editor.subscribe(late);
    }
  });
  removeLater = editor.subscribe((value) => {
    events.push(`later:${value}`);
  });
  editor.set(false);
  editor.set(false);
  editor.set(true);
  const removeDuplicate = editor.subscribe(late);
  removeDuplicate();
  editor.set(false);
  return events;
}

test('native view editability follows synchronous Source transitions, snapshots and duplicate cleanup', () => {
  const source = createEditor({ editable: true });
  const expected = transitions({
    value: () => source.isEditable(),
    set: (value) => source.setEditable(value),
    subscribe: (listener) => source.registerEditableListener(listener),
  });
  expect(expected).toEqual([
    'first:false:false',
    'later:false',
    'first:true:true',
    'late:true',
    'first:false:false',
  ]);
  const fixture = nativeSurface();
  try {
    const before = fixture.session.serializedState();
    const admissions = fixture.counters.admissions;
    expect(
      transitions({
        value: () => fixture.view.isEditable,
        set: (value) => fixture.view.setEditable(value),
        subscribe: (listener) => fixture.view.onEditableChange(listener),
      })
    ).toEqual(expected);
    expect(fixture.root.contentEditable).toBe('false');
    expect(fixture.counters.admissions).toBe(admissions);
    expect(fixture.session.serializedState()).toBe(before);
  } finally {
    fixture.close();
  }
});

test('editability callback opaque failures remain exact and disposal retires all listeners', () => {
  for (const cause of [undefined, null, { failure: 'editable' }]) {
    const fixture = nativeSurface();
    try {
      let later = 0;
      const stop = fixture.view.onEditableChange(() => {
        throw cause;
      });
      fixture.view.onEditableChange(() => later++);
      let observed: { error: unknown } | undefined;
      try {
        fixture.view.setEditable(false);
      } catch (error) {
        observed = { error };
      }
      expect(observed).toBeDefined();
      expect(observed?.error).toBe(cause);
      expect(fixture.view.isEditable).toBe(false);
      expect(later).toBe(0);
      stop();
      fixture.view.dispose();
      fixture.view.setEditable(true);
      expect(later).toBe(0);
    } finally {
      fixture.close();
    }
  }
});

test('embedding capability reads actual initialized native registrations before nodes exist', () => {
  const fixture = nativeSurface();
  try {
    expect(fixture.view.mirror.hasType('document-mention')).toBe(true);
    expect(fixture.view.mirror.hasType('document-card')).toBe(true);
    expect(fixture.view.mirror.hasType('unregistered-document')).toBe(false);
    expect(
      [...fixture.view.mirror.values()].some(
        (node) => node.type === 'document-card'
      )
    ).toBe(false);
    expect(fixture.view.registry.has('document-card')).toBe(false);
  } finally {
    fixture.close();
  }
});
