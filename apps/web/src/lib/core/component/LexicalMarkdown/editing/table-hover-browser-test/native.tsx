import '@app/index.css';
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
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import * as native from '../../../../document-session/wasm/document_session_wasm';
import { theme } from '../../theme';
import { installNativeMarkdownOverlays } from '../installNativeMarkdownOverlays';
import table from './fixtures/table.json';

function element(id: string) {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing table hover fixture element ${id}`);
  return result;
}

await native.default();
const namespace = 'native-table-hover-fixture';
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
element('load-table-controls').addEventListener('click', () =>
  fireAndForget(setState(table), 'table-fixture.load')
);
element('save').addEventListener('click', () => {
  saved = state();
  element('saved').textContent = JSON.stringify({
    engine: 'native',
    state: saved,
  });
});
element('reopen').addEventListener('click', () =>
  fireAndForget(setState(saved), 'table-fixture.reopen')
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
    fireAndForget(runtime.close(), 'table-fixture.close');
  },
  { once: true }
);
await setState(table);
document.documentElement.dataset.ready = 'true';
