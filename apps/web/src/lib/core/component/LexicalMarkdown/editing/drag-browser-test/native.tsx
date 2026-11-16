import '@app/index.css';
import { createNativeEditorDrop } from '@block-md/component/native-editor-drop';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  ABI_MAJOR,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { createRoot, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import * as native from '../../../../document-session/wasm/document_session_wasm';
import { theme } from '../../theme';
import { installNativeMarkdownOverlays } from '../installNativeMarkdownOverlays';
import list from './fixtures/list.json';
import paragraph from './fixtures/paragraph.json';

function element(id: string) {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing drag fixture element ${id}`);
  return result;
}

await native.default();
const namespace = 'native-block-drag-fixture';
const errors: string[] = [];
const report = (error: unknown) => {
  errors.push(String(error));
  document.documentElement.dataset.errors = JSON.stringify(errors);
  throw error;
};
const runtime = mountLocalSessionView(
  element('body'),
  registerMacroElementViews(createBuiltinRegistry()),
  { namespace, theme, editable: true, preset: 'rich', onError: report },
  {
    viewEngine: 1,
    viewOs: 0,
    nativeCommands: native,
    create: (config, now, wall) =>
      native.EditorSession.createMacroWithNamespace(
        ABI_MAJOR,
        config,
        now,
        wall,
        namespace
      ),
  }
);
const [canEdit, setCanEdit] = createSignal(true);
const installation = installNativeMarkdownOverlays(runtime.view, { canEdit });
const disposeUI = render(
  () => (installation.Overlays ? <installation.Overlays /> : null),
  element('menus')
);

async function setState(state: unknown) {
  const outcome = await runtime.port.inputSettled(
    EditorInputMsg.fromEditorSetState({ json: JSON.stringify(state) })
  );
  if (outcome.status === 'error') throw outcome.error;
  if (outcome.status !== 'success')
    throw new Error(`SetState ${outcome.reason}`);
}
const state = () =>
  JSON.parse(runtime.port.query({ kind: 7, key: 0, flags: 0, text: '' }).text);
let saved: unknown;
element('load-drag-blocks').addEventListener('click', () =>
  fireAndForget(setState(paragraph), 'drag-fixture.load')
);
element('load-drag-list').addEventListener('click', () =>
  fireAndForget(setState(list), 'drag-fixture.load')
);
element('save').addEventListener('click', () => {
  saved = state();
  element('saved').textContent = JSON.stringify({
    engine: 'native',
    state: saved,
  });
});
element('reopen').addEventListener('click', () =>
  fireAndForget(setState(saved), 'drag-fixture.reopen')
);
element('readonly').addEventListener('click', () => {
  setCanEdit(false);
  runtime.view.setEditable(false);
});
element('editable').addEventListener('click', () => {
  runtime.view.setEditable(true);
  setCanEdit(true);
});
window.addEventListener(
  'pagehide',
  () => {
    disposeUI();
    installation.dispose();
    fireAndForget(runtime.close(), 'drag-fixture.close');
  },
  { once: true }
);
await setState(paragraph);
if (new URLSearchParams(location.search).has('second')) {
  // A second native editor with the app's body drop owner (RustMarkdownEditor's
  // createNativeEditorDrop), as two documents open side by side, to observe the
  // cross-editor block-handle drop.
  const host = document.createElement('div');
  host.id = 'second';
  host.setAttribute('role', 'textbox');
  host.setAttribute('aria-label', 'Second');
  host.setAttribute('aria-multiline', 'true');
  element('body').after(host);
  const secondNamespace = 'native-block-drag-fixture-second';
  const second = mountLocalSessionView(
    host,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: secondNamespace,
      theme,
      editable: true,
      preset: 'rich',
      onError: report,
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          secondNamespace
        ),
    }
  );
  createRoot(() => {
    const drop = createNativeEditorDrop({
      view: () => second.view,
      canEdit: () => true,
      sourceId: () => 'second-document',
      droppableId: secondNamespace,
      dropFiles: () => {},
    });
    drop.bindView(second.view);
    render(() => <drop.Indicator />, element('menus'));
  });
  const outcome = await second.port.inputSettled(
    EditorInputMsg.fromEditorSetState({
      json: JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'destination' }],
            },
          ],
        },
      }),
    })
  );
  if (outcome.status !== 'success')
    throw new Error(`Second SetState ${outcome.status}`);
}
document.documentElement.dataset.ready = 'true';
