import { fireAndForget } from '@core/util/fireAndForget';
import {
  ABI_MAJOR,
  SelectionMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { mountLocalSessionView } from '@macro-inc/lexical-wasm-view';
import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import { getOwner, onCleanup, onMount } from 'solid-js';
import { theme } from '../../theme';
import { createNativeDocumentCardContext } from '../native-document-card-host';
import { createNativeDocumentCardViews } from '../native-document-card-views';
import { createNativeDocumentMentionContext } from '../native-document-mention-host';
import { createNativeDocumentMentionViews } from '../native-document-mention-views';

export function NativeReferenceFixture(props: {
  shape: 'document-card' | 'document-mention';
}) {
  const owner = getOwner();
  const mention = createNativeDocumentMentionContext(theme, {
    isInteractable: () => true,
  });
  const card = createNativeDocumentCardContext(theme, {
    isInteractable: () => true,
  });
  let root: HTMLDivElement | undefined;
  let runtime: ReturnType<typeof mountLocalSessionView> | undefined;
  let disposed = false;
  onMount(() => {
    async function start() {
      const native = await import(
        '@core/document-session/wasm/document_session_wasm.js'
      );
      await native.default();
      if (disposed) return;
      if (!root || !window.documentReferenceInitial)
        throw new Error('Missing actual native root or frozen input');
      const registry = registerMacroDecoratorViews(
        registerMacroElementViews(createBuiltinRegistry()),
        {
          ...createNativeDocumentMentionViews(mention),
          ...createNativeDocumentCardViews(card),
        }
      );
      runtime = mountLocalSessionView(
        root,
        registry,
        {
          namespace: 'document-mention-fixture',
          theme,
          editable: true,
          preset: 'rich',
          owner: owner ?? undefined,
          onError(error) {
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
          nativeCommands: native,
          create: (config, now, wall) =>
            native.EditorSession.createMacroWithNamespace(
              ABI_MAJOR,
              config,
              now,
              wall,
              'document-mention-fixture'
            ),
        }
      );
      const actual = runtime;
      if (new URLSearchParams(location.search).get('earlyClear') === '1') {
        const Enter = createViewCommand(
          'Key(Enter)',
          (event): event is KeyboardEvent | null =>
            event === null || event instanceof KeyboardEvent
        );
        actual.view.registerViewCommand(
          Enter,
          () => {
            const scope = actual.port.nativeEnter?.scope();
            if (!scope) throw new Error('Missing issued native Enter scope');
            native.viewCommandScopeSetSelection(
              scope.scope,
              SelectionMsg.encode(selectionMessage({ kind: 'none' }))
            );
            return false;
          },
          2
        );
      }
      if (
        [...actual.view.mirror.values()].some(
          (node) => node.kind === 'decorator'
        )
      )
        throw new Error('Decorator observed before import');
      actual.port.setState(window.documentReferenceInitial);
      window.documentMentionFixture = {
        capture: () => ({
          model: actual.view.query.serializedState(),
          dom: actual.view.root.innerHTML,
        }),
        select() {
          const node = [...actual.view.mirror.values()].find(
            (node) => node.type === props.shape
          );
          if (!node) throw new Error('Missing actual native reference');
          actual.port.selectionFromView({ kind: 'node', keys: [node.key] });
        },
        clear() {
          actual.port.selectionFromView({ kind: 'none' });
        },
        enter() {
          const port = actual.port.nativeEnter;
          if (!port) throw new Error('Missing actual ordered Enter');
          return port.dispatch();
        },
        componentProps: () => {
          const node = [...actual.view.mirror.values()].find(
            (node) => node.type === props.shape
          );
          if (!node) throw new Error('Missing native reference props');
          return node.props();
        },
      };
    }
    fireAndForget(start(), 'document-reference-fixture.start');
  });
  onCleanup(() => {
    disposed = true;
    delete window.documentMentionFixture;
    mention.dispose();
    card.dispose();
    if (runtime)
      fireAndForget(runtime.close(), 'document-reference-fixture.close');
  });
  return (
    <div
      ref={root}
      contentEditable
      role="textbox"
      aria-label="Document mention fixture"
      class="md w-[640px] min-h-40 p-4 outline-none"
    />
  );
}
