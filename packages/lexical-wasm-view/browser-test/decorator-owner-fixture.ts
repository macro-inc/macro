import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createComponent,
  createContext,
  getOwner,
  onCleanup,
  useContext,
} from 'solid-js';
import { render } from 'solid-js/web';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '../src/view/node-views/macro';

await init();
const host = document.getElementById('host');
const root = document.getElementById('editor');
if (!host || !root) throw new Error('Missing fixture roots');
const context = createContext('missing');
let unmounts = 0;
let dispose: (() => void) | undefined;
const registry = registerMacroElementViews(createBuiltinRegistry());
registerMacroDecoratorViews(registry, {
  'user-mention': () => {
    const element = document.createElement('span');
    element.textContent = useContext(context);
    element.dataset.decoratorContext = 'true';
    onCleanup(() => unmounts++);
    return element;
  },
});
const mounted = await new Promise<
  Awaited<ReturnType<typeof mountLocalSessionView>>
>((resolve, reject) => {
  dispose = render(
    () =>
      createComponent(context.Provider, {
        value: 'application context',
        get children() {
          const options = {
            namespace: 'owner-fixture',
            theme: {},
            editable: true,
            preset: 'rich' as const,
            owner: getOwner() ?? undefined,
            onError: reject,
          };
          Promise.resolve()
            .then(() =>
              mountLocalSessionView(root, registry, options, {
                viewEngine: 1,
                viewOs: 0,
                create: (config, now, wall) =>
                  EditorSession.createMacro(ABI_MAJOR, config, now, wall),
              })
            )
            .then(resolve, reject);
          return null;
        },
      }),
    host
  );
});
window.decoratorOwner = {
  insert() {
    mounted.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'user-mention',
                  userId: 'fixture',
                  displayName: 'Fixture',
                },
              ],
            },
          ],
        },
      })
    );
  },
  clear() {
    mounted.port.setState(
      JSON.stringify({
        root: { type: 'root', children: [{ type: 'paragraph', children: [] }] },
      })
    );
    return unmounts;
  },
  async close() {
    await mounted.close();
    dispose?.();
    return unmounts;
  },
};
declare global {
  interface Window {
    decoratorOwner: {
      insert(): void;
      clear(): number;
      close(): Promise<number>;
    };
  }
}
