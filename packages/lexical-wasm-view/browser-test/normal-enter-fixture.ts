import { registerRichText } from '@lexical/rich-text';
import {
  ABI_MAJOR,
  CommandCode,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  KEY_ENTER_COMMAND,
} from 'lexical';
import init, * as native from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { $setId } from '../../lexical-core/plugins/nodeIdPlugin';
import { mountLocalSessionView } from '../src/local-session-view';
import { createViewCommand } from '../src/view/commands';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';

function editorRoot(id: string): HTMLElement {
  const root = document.getElementById(id);
  if (!root) throw new Error('Missing actual editor root');
  return root;
}
const sourceRoot = editorRoot('source');
const nativeRoot = editorRoot('native');
for (const root of [sourceRoot, nativeRoot]) {
  root.style.cssText =
    'min-height:80px;white-space:pre-wrap;border:1px solid;padding:8px;margin:8px';
}
const errors: string[] = [];
const sourceTrace: string[] = [];
const nativeTrace: string[] = [];
const source = createEditor({
  namespace: 'normal-enter-source',
  theme: {},
  onError: (error) => {
    errors.push(String(error));
    throw error;
  },
});
sourceRoot.contentEditable = 'true';
source.setRootElement(sourceRoot);
registerRichText(source);
source.update(
  () => {
    const root = $getRoot();
    const paragraph = $createParagraphNode();
    const text = $createTextNode('draft');
    $setId(root, 'enter-root');
    $setId(paragraph, 'enter-paragraph');
    $setId(text, 'enter-text');
    root.append(paragraph.append(text));
  },
  { discrete: true }
);
const initial = JSON.stringify(source.getEditorState().toJSON());
await init();
const mounted = mountLocalSessionView(
  nativeRoot,
  createBuiltinRegistry(),
  {
    namespace: 'normal-enter-native',
    theme: {},
    editable: true,
    preset: 'rich',
    onError: (error) => {
      errors.push(String(error));
      throw error;
    },
  },
  {
    viewEngine: /Firefox/.test(navigator.userAgent)
      ? 3
      : /AppleWebKit/.test(navigator.userAgent) &&
          !/Chrome/.test(navigator.userAgent)
        ? 2
        : 1,
    viewOs: 0,
    create: (config, now, wall) =>
      native.EditorSession.create(ABI_MAJOR, config, now, wall),
    nativeCommands: native,
  }
);
mounted.port.setState(initial);
const enter = createViewCommand(
  'Key(Enter)',
  (value): value is KeyboardEvent | null =>
    value === null || value instanceof KeyboardEvent
);
source.registerCommand(
  KEY_ENTER_COMMAND,
  (event) => {
    sourceTrace.push(event === null ? 'first:null' : `first:${event.key}`);
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error('Source range missing');
    selection.insertText('!');
    return false;
  },
  2
);
source.registerCommand(
  KEY_ENTER_COMMAND,
  () => {
    sourceTrace.push(`pending:${$getRoot().getTextContent()}`);
    sourceTrace.push(
      `published:${source.getEditorState().read(() => $getRoot().getTextContent())}`
    );
    return false;
  },
  2
);
source.registerCommand(
  KEY_ENTER_COMMAND,
  (event) => {
    sourceTrace.push('last');
    event?.preventDefault();
    return true;
  },
  2
);
mounted.view.registerViewCommand(
  enter,
  (event) => {
    nativeTrace.push(event === null ? 'first:null' : `first:${event.key}`);
    const commands = mounted.port.nativeEnter;
    if (!commands) throw new Error('Explicit native Enter binding missing');
    commands.dispatchScoped(
      EditorInputMsg.fromEditorCommand({
        command: CommandCode.InsertText,
        a: 0,
        b: 0,
        text: '!',
        selection: {
          kind: 0,
          anchor: { key: 0, offset: 0, type: 0 },
          focus: { key: 0, offset: 0, type: 0 },
          nodes: [],
          table: 0,
          dirty: false,
        },
        target: {
          kind: 0,
          anchor: { key: 0, offset: 0, type: 0 },
          focus: { key: 0, offset: 0, type: 0 },
          dirty: false,
          backward: false,
        },
        characterTarget: {
          kind: 0,
          anchor: { key: 0, offset: 0, type: 0 },
          focus: { key: 0, offset: 0, type: 0 },
          dirty: false,
          backward: false,
        },
      })
    );
    return false;
  },
  2
);
mounted.view.registerViewCommand(
  enter,
  () => {
    const key = [...mounted.view.mirror.values()].find(
      (node) => node.kind === 'text'
    )?.key;
    if (key === undefined || !mounted.port.nativeEnter)
      throw new Error('Native pending text missing');
    nativeTrace.push(`pending:${mounted.port.nativeEnter.pendingText(key)}`);
    nativeTrace.push(`published:${mounted.view.text(key)}`);
    return false;
  },
  2
);
mounted.view.registerViewCommand(
  enter,
  (event) => {
    nativeTrace.push('last');
    event?.preventDefault();
    return true;
  },
  2
);

function reset() {
  source.setEditorState(source.parseEditorState(initial));
  source.update(() => $getRoot().selectEnd(), { discrete: true });
  mounted.port.setState(initial);
  const text = [...mounted.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Native initial text missing');
  mounted.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 5, type: 'text' },
    focus: { key: text.key, offset: 5, type: 'text' },
  });
  sourceTrace.length = 0;
  nativeTrace.length = 0;
}
function snapshot(engine: 'source' | 'native') {
  if (engine === 'source')
    return {
      trace: [...sourceTrace],
      json: JSON.stringify(source.getEditorState().toJSON()),
      text: sourceRoot.textContent,
      errors: [...errors],
    };
  return {
    trace: [...nativeTrace],
    json: mounted.view.query.serializedState(),
    text: nativeRoot.textContent,
    errors: [...errors],
  };
}
window.normalEnter = {
  reset,
  snapshot,
  programmatic(engine) {
    if (engine === 'source')
      source.update(
        () => {
          source.dispatchCommand(KEY_ENTER_COMMAND, null);
        },
        { discrete: true }
      );
    else mounted.port.nativeEnter?.dispatch();
  },
};
reset();
declare global {
  interface Window {
    normalEnter: {
      reset(): void;
      snapshot(engine: 'source' | 'native'): {
        trace: string[];
        json: string;
        text: string | null;
        errors: string[];
      };
      programmatic(engine: 'source' | 'native'): void;
    };
  }
}
