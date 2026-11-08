import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';

await init();
const errors: string[] = [];
async function mount(id: string, editable: boolean) {
  const root = document.getElementById(id);
  if (!root) throw new Error('Missing local surface');
  return mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: id,
      theme: {},
      editable,
      preset: 'rich',
      onError: (error) => errors.push(String(error)),
    },
    {
      viewEngine: 1,
      viewOs: 0,
      create: (config, now, wall) =>
        EditorSession.createMacro(ABI_MAJOR, config, now, wall),
    }
  );
}
const first = await mount('first', true);
const second = await mount('second', true);
const preview = await mount('preview', false);
preview.port.setState(
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'Read-only content' }],
        },
      ],
    },
  })
);
const localSessions = {
  errors,
  markdown: () =>
    [first, second].map((item) => item.executor.session.markdown(1)),
  undo: () => first.port.command(CommandCode.Undo),
  redo: () => first.port.command(CommandCode.Redo),
  async close() {
    await Promise.all([
      first.close(),
      first.close(),
      second.close(),
      preview.close(),
    ]);
  },
};
Object.assign(window, { localSessions });
declare global {
  interface Window {
    localSessions: typeof localSessions;
  }
}
