import '@app/index.css';
import {
  ABI_MAJOR,
  CommandCode,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import { isFirefox, isIOS, isSafari } from '@solid-primitives/platform';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { loadDocumentSession } from '../../../../document-session/load';
import { FocusClickTarget } from '../../component/core/FocusClickTarget';
import { theme } from '../../theme';
import { installNativeMarkdownOverlays } from '../installNativeMarkdownOverlays';
import { createNativeFocusTarget } from '../overlay-hosts/native-focus';
import blockGap from './fixtures/block-gap.json';
import tableSelection from './fixtures/table-selection.json';

function element(id: string) {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Missing native overlay fixture element ${id}`);
  return target;
}

const module = await loadDocumentSession();
const namespace = 'native-overlay-fixture';
const errors: string[] = [];
const runtime = mountLocalSessionView(
  element('body'),
  registerMacroElementViews(createBuiltinRegistry()),
  {
    namespace,
    theme,
    editable: true,
    preset: 'rich',
    onError(error) {
      errors.push(String(error));
      element('errors').textContent = JSON.stringify(errors);
    },
  },
  {
    viewEngine: isIOS || isSafari ? 2 : isFirefox ? 3 : 1,
    viewOs: 0,
    create: (config, now, wall) =>
      module.EditorSession.createMacroWithNamespace(
        ABI_MAJOR,
        config,
        now,
        wall,
        namespace
      ),
  }
);
const [canEdit, setCanEdit] = createSignal(true);
let installation = installNativeMarkdownOverlays(runtime.view, { canEdit });
let focusCalls = 0;
const focus = runtime.view.focus.bind(runtime.view);
runtime.view.focus = () => {
  focusCalls++;
  focus();
};
render(
  () => (
    <FocusClickTarget
      data-testid="exterior"
      style={{ height: '80px' }}
      native={createNativeFocusTarget(
        () => ({ view: runtime.view, overlays: installation }),
        () => runtime.view.root.contentEditable === 'true'
      )}
    />
  ),
  element('exterior')
);
runtime.port.setState(
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'list',
          version: 1,
          listType: 'check',
          tag: 'ul',
          start: 1,
          children: [
            {
              type: 'listitem',
              version: 1,
              checked: false,
              value: 1,
              children: [{ type: 'text', version: 1, text: 'Retained check' }],
            },
          ],
        },
      ],
    },
  })
);
element('readonly').addEventListener('click', () => {
  setCanEdit(false);
  runtime.view.setEditable(false);
});
element('editable').addEventListener('click', () => {
  setCanEdit(true);
  runtime.view.setEditable(true);
});
element('revoke').addEventListener('click', () => {
  runtime.executor.run(() =>
    runtime.executor.session.authorization(
      true,
      false,
      false,
      runtime.executor.now(),
      Date.now()
    )
  );
});
element('dispose').addEventListener('click', () => {
  installation.dispose();
  installation.dispose();
});
element('remount').addEventListener('click', () => {
  installation.dispose();
  installation = installNativeMarkdownOverlays(runtime.view, { canEdit });
});
let saved: string | undefined;
element('save').addEventListener('click', () => {
  saved = runtime.executor.session.serializedState();
  element('saved').textContent = saved;
});
element('reopen').addEventListener('click', () => {
  if (saved !== undefined) runtime.port.setState(saved);
});
function queueFocus(effect: 'none' | 'dispose' | 'readonly') {
  const before = focusCalls;
  let duringCalls: number | undefined;
  let duringParagraphs: number | undefined;
  // This real native selection input's completion runs while the real executor
  // is busy. The nested application action must queue until completion returns.
  runtime.port.input(
    EditorInputMsg.fromEditorSelection({
      selection: selectionMessage({ kind: 'none' }),
      change: {},
    }),
    () => {
      installation.focusAtEnd?.();
      if (effect === 'dispose') installation.dispose();
      if (effect === 'readonly') runtime.view.setEditable(false);
      duringCalls = focusCalls - before;
      duringParagraphs =
        runtime.view.root.querySelectorAll(':scope > p').length;
    }
  );
  // The ordinary queue has now drained; these are published view facts.
  element('queued').textContent = JSON.stringify({
    duringCalls,
    afterCalls: focusCalls - before,
    duringParagraphs,
    afterParagraphs: runtime.view.root.querySelectorAll(':scope > p').length,
  });
}
element('queue-focus').addEventListener('click', () => queueFocus('none'));
element('queue-dispose').addEventListener('click', () => queueFocus('dispose'));
element('queue-readonly').addEventListener('click', () =>
  queueFocus('readonly')
);
const reportState = () => {
  element('live-state').textContent =
    runtime.executor.session.serializedState();
  element('selection').textContent = JSON.stringify(
    runtime.view.selection().selection
  );
};
runtime.view.onCommit(() => queueMicrotask(reportState));
element('load-gap').addEventListener('click', () => {
  runtime.port.setState(JSON.stringify(blockGap));
  runtime.port.command(CommandCode.ClearHistory);
});
element('load-table').addEventListener('click', () =>
  runtime.port.setState(JSON.stringify(tableSelection))
);
function queueGap(effect: 'none' | 'dispose' | 'readonly') {
  const before = focusCalls;
  let duringCalls: number | undefined;
  runtime.port.input(
    EditorInputMsg.fromEditorSelection({
      selection: selectionMessage({ kind: 'none' }),
      change: {},
    }),
    () => {
      const first = runtime.view.root.children[0].getBoundingClientRect();
      const second = runtime.view.root.children[1].getBoundingClientRect();
      runtime.view.root.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: first.left + first.width / 2,
          clientY: (first.bottom + second.top) / 2,
        })
      );
      if (effect === 'dispose') installation.dispose();
      if (effect === 'readonly') {
        setCanEdit(false);
        runtime.view.setEditable(false);
      }
      duringCalls = focusCalls - before;
    }
  );
  element('queued').textContent = JSON.stringify({
    duringCalls,
    afterCalls: focusCalls - before,
  });
}
element('queue-gap').addEventListener('click', () => queueGap('none'));
element('queue-gap-dispose').addEventListener('click', () =>
  queueGap('dispose')
);
element('queue-gap-readonly').addEventListener('click', () =>
  queueGap('readonly')
);
reportState();
document.documentElement.dataset.ready = 'true';
