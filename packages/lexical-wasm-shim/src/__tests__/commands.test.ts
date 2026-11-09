import { expect, test } from 'vitest';
import {
  $createParagraphNode,
  $createTextNode,
  $getEditor,
  $getRoot,
  COMMAND_PRIORITY_BEFORE_CRITICAL,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  createEditor,
} from '../index';

test('JS commands retain arbitrary payload identity and priority deque order', () => {
  const editor = createEditor();
  const trace: string[] = [];
  const payload = {
    value: Symbol('payload'),
    large: 18446744073709551616n,
    callback: () => 'unchanged',
    toJSON: () => {
      throw new Error('Command payload must not serialize');
    },
  };
  const command = createCommand<typeof payload>();
  try {
    editor.registerCommand(
      command,
      (value: typeof payload, origin) => {
        expect(value).toBe(payload);
        expect(origin).toBe(editor);
        expect($getEditor()).toBe(editor);
        trace.push('critical');
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );
    const front = () => {
      trace.push('front');
      return false;
    };
    editor.registerCommand(command, front, COMMAND_PRIORITY_BEFORE_CRITICAL);
    editor.registerCommand(command, front, COMMAND_PRIORITY_BEFORE_CRITICAL);
    editor.registerCommand(
      command,
      () => {
        trace.push('high');
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    editor.registerCommand(
      command,
      () => {
        trace.push('editor');
        return false;
      },
      COMMAND_PRIORITY_EDITOR
    );
    expect(editor.dispatchCommand(command, payload)).toBe(true);
    expect(trace).toEqual(['front', 'critical', 'high']);
  } finally {
    editor.dispose();
  }
});

test('nested dispatch is synchronous and listeners iterate a stable snapshot', () => {
  const editor = createEditor();
  const first = createCommand();
  const nested = createCommand();
  const trace: string[] = [];
  let removeSecond = () => {};
  try {
    editor.registerCommand(
      nested,
      () => {
        trace.push('nested');
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
    editor.registerCommand(
      first,
      () => {
        trace.push('first');
        removeSecond();
        editor.registerCommand(
          first,
          () => {
            trace.push('new');
            return false;
          },
          COMMAND_PRIORITY_EDITOR
        );
        expect(editor.dispatchCommand(nested, undefined)).toBe(true);
        trace.push('after nested');
        return false;
      },
      COMMAND_PRIORITY_EDITOR
    );
    removeSecond = editor.registerCommand(
      first,
      () => {
        trace.push('removed snapshot member');
        return false;
      },
      COMMAND_PRIORITY_EDITOR
    );
    expect(editor.dispatchCommand(first, undefined)).toBe(false);
    expect(trace).toEqual([
      'first',
      'nested',
      'after nested',
      'removed snapshot member',
    ]);
  } finally {
    editor.dispose();
  }
});

test('parent propagation uses each owner update and preserves the originating editor', () => {
  const parent = createEditor();
  const child = createEditor({ parentEditor: parent });
  const command = createCommand();
  const trace: string[] = [];
  try {
    child.registerCommand(
      command,
      (_payload, origin) => {
        expect(origin).toBe(child);
        expect($getEditor()).toBe(child);
        trace.push('child');
        return false;
      },
      COMMAND_PRIORITY_EDITOR
    );
    parent.registerCommand(
      command,
      (_payload, origin) => {
        expect(origin).toBe(child);
        expect($getEditor()).toBe(parent);
        trace.push('parent');
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
    expect(child.dispatchCommand(command, null)).toBe(true);
    expect(trace).toEqual(['child', 'parent']);
    trace.length = 0;
    parent.update(
      () => {
        expect(child.dispatchCommand(command, null)).toBe(false);
        trace.push('parent body');
      },
      { discrete: true }
    );
    expect(trace).toEqual(['child', 'parent body', 'parent']);
  } finally {
    child.dispose();
    parent.dispose();
  }
});

test('dispatch from an update listener completes synchronously before returning', () => {
  const editor = createEditor();
  const command = createCommand();
  const trace: string[] = [];
  try {
    editor.registerCommand(
      command,
      () => {
        trace.push('command');
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
    editor.registerUpdateListener(() => {
      trace.push('listener');
      const handled = editor.dispatchCommand(command, undefined);
      trace.push(`returned:${handled}`);
    });
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('x')));
      },
      { discrete: true }
    );
    expect(trace).toEqual(['listener', 'command', 'returned:true']);
  } finally {
    editor.dispose();
  }
});

test('an updating ancestor defers command propagation throughout listener notification', () => {
  const parent = createEditor();
  const child = createEditor({ parentEditor: parent });
  const command = createCommand();
  const trace: string[] = [];
  try {
    parent.registerCommand(
      command,
      () => {
        trace.push('parent command');
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
    parent.registerUpdateListener(() => {
      trace.push('listener start');
      expect(parent._updating).toBe(true);
      trace.push(`returned:${child.dispatchCommand(command, undefined)}`);
      trace.push('listener end');
    });
    parent.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('x')));
      },
      { discrete: true }
    );
    expect(trace).toEqual([
      'listener start',
      'returned:false',
      'listener end',
      'parent command',
    ]);
    expect(parent._updating).toBe(false);
  } finally {
    child.dispose();
    parent.dispose();
  }
});

test('onUpdate callbacks retain the updating phase through ancestor deferral', () => {
  const parent = createEditor();
  const child = createEditor({ parentEditor: parent });
  const command = createCommand();
  const trace: string[] = [];
  try {
    parent.registerCommand(
      command,
      () => {
        trace.push('parent command');
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
    parent.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('x')));
      },
      {
        discrete: true,
        onUpdate: () => {
          expect(parent._updating).toBe(true);
          trace.push(`returned:${child.dispatchCommand(command, undefined)}`);
          trace.push('callback end');
        },
      }
    );
    expect(trace).toEqual(['returned:false', 'callback end', 'parent command']);
    expect(parent._updating).toBe(false);
  } finally {
    child.dispose();
    parent.dispose();
  }
});
