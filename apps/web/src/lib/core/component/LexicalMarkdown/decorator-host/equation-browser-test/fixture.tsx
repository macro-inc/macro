import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { $dfs } from '@lexical/utils';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { $createEquationNode } from '@macro-inc/lexical-core';
import { $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { mountLocalSessionView } from '@macro-inc/lexical-wasm-view';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { $createParagraphNode, $getRoot } from 'lexical';
import { createSignal, getOwner, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { FloatingEquationMenu } from '../../component/menu/FloatingEquationMenu';
import { DecoratorHostContext } from '../../context/DecoratorHostContext';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { initializeLexical } from '../../init';
import {
  $getDocumentMetadata,
  documentMetadataPlugin,
} from '../../plugins/document-metadata/documentMetadataPlugin';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph/trailingParagraphPlugin';
import { theme } from '../../theme';
import { createNativeEquationContext } from '../native-equation-host';
import { createNativeEquationViews } from '../native-equation-views';
import initialize, { EditorSession } from './wasm/document_session_wasm.js';

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});
interface Capture {
  model: string;
  dom: string;
  shadows: readonly string[];
}
declare global {
  interface Window {
    equationProofInput?: string;
    equationProofClose?: () => Promise<void>;
    equationProofFixture?: {
      snapshot(): Capture;
      setCanEdit(value: boolean): void;
      close(): Promise<void>;
    };
  }
}
function Fixture() {
  const engine = new URLSearchParams(location.search).get('engine');
  const owner = getOwner();
  const [canEdit, setCanEdit] = createSignal(true);
  const wrapper =
    engine === 'native'
      ? undefined
      : createLexicalWrapper({
          type: 'markdown-sync',
          namespace: 'equation-fixture',
          isInteractable: () => true,
          withIds: true,
          theme,
        });
  wrapper?.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(trailingParagraphPlugin())
    .use(documentMetadataPlugin({}));
  const nativeContext =
    engine === 'native' ? createNativeEquationContext(theme) : undefined;
  let root: HTMLDivElement | undefined;
  let close: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const closeOnce = () => {
    closing ??= (async () => {
      try {
        await close?.();
      } finally {
        nativeContext?.dispose();
      }
    })();
    return closing;
  };
  window.equationProofClose = closeOnce;
  onMount(async () => {
    if (!root) throw new Error('Missing Equation proof root');
    const element = root;
    let model: () => string;
    if (engine === 'native') {
      if (typeof window.equationProofInput !== 'string')
        throw new Error('Missing frozen import input');
      await initialize();
      if (closing) return;
      if (!nativeContext) throw new Error('Missing actual equation context');
      const registry = registerMacroElementViews(createBuiltinRegistry());
      registerMacroDecoratorViews(
        registry,
        createNativeEquationViews(nativeContext)
      );
      const surface = mountLocalSessionView(
        element,
        registry,
        {
          namespace: 'equation-fixture',
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
          create: (config, now, wall) =>
            EditorSession.createMacroWithNamespace(
              ABI_MAJOR,
              config,
              now,
              wall,
              'equation-fixture'
            ),
        }
      );
      close = async () => {
        nativeContext.dispose();
        await surface.close();
      };
      if (element.querySelector('[data-lexical-decorator]'))
        throw new Error('Observed native decorator before import');
      surface.port.setState(window.equationProofInput);
      model = () => surface.executor.session.serializedState();
    } else {
      if (!wrapper) throw new Error('Missing actual Source wrapper');
      close = async () => {
        wrapper.editor.setRootElement(null);
        wrapper.cleanup();
      };
      wrapper.editor.setRootElement(element);
      if (element.querySelector('[data-lexical-decorator]'))
        throw new Error('Observed Source decorator before import');
      if (engine === 'factory') {
        wrapper.editor.update(
          () => {
            const node = $getRoot();
            $setId(node, 'equation-proof-root');
            node.append(
              $createParagraphNode().append($createEquationNode('x^2+1', true)),
              $createEquationNode('\\sum_{i=1}^{n} i', false),
              $createParagraphNode()
            );
            for (const [index, { node: child }] of $dfs().slice(1).entries())
              $setId(child, `equation-proof-${index}`);
          },
          { discrete: true }
        );
      } else {
        if (typeof window.equationProofInput !== 'string')
          throw new Error('Missing frozen import input');
        wrapper.editor.getEditorState().read(() => $getDocumentMetadata());
        wrapper.editor.setEditorState(
          wrapper.editor.parseEditorState(window.equationProofInput)
        );
      }
      model = () => JSON.stringify(wrapper.editor.getEditorState().toJSON());
    }
    window.equationProofFixture = {
      setCanEdit,
      snapshot() {
        return {
          model: model(),
          dom: element.innerHTML,
          shadows: [...element.querySelectorAll('*')].flatMap((child) =>
            child.shadowRoot ? [child.shadowRoot.innerHTML] : []
          ),
        };
      },
      close: closeOnce,
    };
  });
  onCleanup(() => {
    delete window.equationProofFixture;
    delete window.equationProofClose;
    closeOnce().catch((error) => console.error(error));
  });
  const content = () => (
    <FloatingMenuGroup>
      <div
        ref={root}
        role="textbox"
        aria-label="Equation proof"
        contentEditable
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
      {wrapper && <DecoratorRenderer editor={wrapper.editor} />}
      <FloatingEquationMenu canEdit={canEdit} />
    </FloatingMenuGroup>
  );
  return wrapper ? (
    <LexicalWrapperContext.Provider value={wrapper}>
      {content()}
    </LexicalWrapperContext.Provider>
  ) : (
    <DecoratorHostContext.Provider value={nativeContext?.host}>
      {content()}
    </DecoratorHostContext.Provider>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture host');
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <EmailLinksContextProvider>
              <MobileSettingsProvider>
                <MemoryRouter>
                  <Route path="*" component={Fixture} />
                </MemoryRouter>
              </MobileSettingsProvider>
            </EmailLinksContextProvider>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
