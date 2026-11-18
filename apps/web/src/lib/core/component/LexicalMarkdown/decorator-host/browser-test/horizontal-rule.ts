import '@app/index.css';
import init, {
  EditorSession,
} from '@core/document-session/wasm/document_session_wasm.js';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { mountLocalSessionView } from '@macro-inc/lexical-wasm-view';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import { createNativeHorizontalRuleViews } from '../native-horizontal-rule';

await init();
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
root.setAttribute('role', 'textbox');
root.setAttribute('aria-label', 'Native horizontal-rule fixture');
root.className = 'md w-[640px] min-h-80 p-4';
const errors: string[] = [];
// This scoped component fixture does not install the complete Macro registry.
const registry = registerMacroElementViews(createBuiltinRegistry());
let bindingCount = 0;
registerMacroDecoratorViews(
  registry,
  createNativeHorizontalRuleViews(() => {
    bindingCount++;
  })
);
const runtime = mountLocalSessionView(
  root,
  registry,
  {
    namespace: 'horizontal-rule-fixture',
    preset: 'rich',
    theme: {},
    editable: true,
    onError(error) {
      errors.push(String(error));
    },
  },
  {
    viewEngine: 1,
    viewOs: 0,
    create: (config, now, wall) =>
      EditorSession.createMacro(ABI_MAJOR, config, now, wall),
  }
);
runtime.port.setState(
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        { type: 'horizontalrule', version: 1 },
        { type: 'horizontalrule', version: 1 },
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'after' }],
        },
      ],
    },
  })
);
const horizontalRuleFixture = {
  snapshot() {
    return {
      errors,
      bindingCount,
      selection: runtime.view.selection().selection,
      keys: runtime.view.node(0)?.children,
      types: runtime.view
        .node(0)
        ?.children.map((key) => runtime.view.node(key)?.type),
    };
  },
  deselect() {
    runtime.port.selectionFromView({ kind: 'none' });
  },
  close: () => runtime.close(),
};
Object.assign(window, { horizontalRuleFixture });
declare global {
  interface Window {
    horizontalRuleFixture: typeof horizontalRuleFixture;
  }
}
