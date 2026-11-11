import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { $dfs } from '@lexical/utils';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import { $createImageNode, $isImageNode } from '@macro-inc/lexical-core';
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
import { getOwner, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { initializeLexical } from '../../init';
import {
  $getDocumentMetadata,
  documentMetadataPlugin,
} from '../../plugins/document-metadata/documentMetadataPlugin';
import { dispatchApplicationCommandSettled } from '../../plugins/group-b/command';
import { mediaPlugin } from '../../plugins/media';
import { createNativeMediaUploadEvents } from '../../plugins/media/native-upload-events';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph/trailingParagraphPlugin';
import { theme } from '../../theme';
import { createNativeImageContext } from '../native-image-host';
import { createNativeImageDecoratorViews } from '../native-image-views';
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
    imageProofInput?: string;
    imageProofClose?: () => Promise<void>;
    imageProofFixture?: {
      snapshot(): Capture;
      setUrl(url: string, rerender: boolean): Promise<void>;
      close(): Promise<void>;
    };
  }
}
function Fixture() {
  const engine = new URLSearchParams(location.search).get('engine');
  const owner = getOwner();
  const wrapper =
    engine === 'native'
      ? undefined
      : createLexicalWrapper({
          type: 'markdown-sync',
          namespace: 'image-fixture',
          isInteractable: () => true,
          withIds: true,
          theme,
        });
  wrapper?.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(mediaPlugin())
    .use(trailingParagraphPlugin())
    .use(documentMetadataPlugin({}));
  const uploads = createNativeMediaUploadEvents();
  const nativeContext =
    engine === 'native'
      ? createNativeImageContext(theme, () => true, uploads)
      : undefined;
  let root: HTMLDivElement | undefined;
  let close: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const closeOnce = () => {
    closing ??= (async () => {
      try {
        await close?.();
      } finally {
        nativeContext?.dispose();
        uploads.dispose();
      }
    })();
    return closing;
  };
  window.imageProofClose = closeOnce;
  onMount(async () => {
    if (!root) throw new Error('Missing Image proof root');
    const element = root;
    let model: () => string;
    let setUrl: (url: string, rerender: boolean) => Promise<void>;
    if (engine === 'native') {
      if (typeof window.imageProofInput !== 'string')
        throw new Error('Missing frozen import input');
      await initialize();
      if (closing) return;
      if (!nativeContext) throw new Error('Missing actual image context');
      const registry = registerMacroElementViews(createBuiltinRegistry());
      registerMacroDecoratorViews(
        registry,
        createNativeImageDecoratorViews(nativeContext)
      );
      const surface = mountLocalSessionView(
        element,
        registry,
        {
          namespace: 'image-fixture',
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
              'image-fixture'
            ),
        }
      );
      close = async () => {
        nativeContext.dispose();
        await surface.close();
      };
      if (element.querySelector('[data-lexical-decorator]'))
        throw new Error('Observed native decorator before import');
      surface.port.setState(window.imageProofInput);
      model = () => surface.executor.session.serializedState();
      setUrl = async (url, rerender) => {
        const image = [...surface.view.mirror.values()].find(
          (node) => node.type === 'image'
        );
        if (!image) throw new Error('Missing actual native image');
        const outcome = await dispatchApplicationCommandSettled(
          surface.view,
          'group-b.media-set-property',
          {
            key: image.key,
            kind: 'image',
            property: 'url',
            value: url,
            rerender,
          }
        );
        if (outcome.status === 'error') throw outcome.error;
        if (outcome.status !== 'success' || !outcome.handled)
          throw new Error('Native image setter was not handled');
      };
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
            $setId(node, 'image-proof-root');
            node.append(
              $createImageNode({
                srcType: 'url',
                url: 'https://static.klipy.com/fixture/image.svg',
                alt: 'Fixture image',
                width: 256,
                height: 128,
              }),
              $createParagraphNode()
            );
            for (const [index, { node: child }] of $dfs().slice(1).entries())
              $setId(child, `image-proof-${index}`);
          },
          { discrete: true }
        );
      } else {
        if (typeof window.imageProofInput !== 'string')
          throw new Error('Missing frozen import input');
        wrapper.editor.getEditorState().read(() => $getDocumentMetadata());
        wrapper.editor.setEditorState(
          wrapper.editor.parseEditorState(window.imageProofInput)
        );
      }
      model = () => JSON.stringify(wrapper.editor.getEditorState().toJSON());
      setUrl = async (url, rerender) => {
        wrapper.editor.update(
          () => {
            const image = $getRoot().getFirstChild();
            if (!image || !$isImageNode(image))
              throw new Error('Missing actual Source image');
            image.setUrl(url, rerender);
          },
          { discrete: true }
        );
      };
    }
    window.imageProofFixture = {
      setUrl,
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
    delete window.imageProofFixture;
    delete window.imageProofClose;
    closeOnce().catch((error) => console.error(error));
  });
  const content = () => (
    <>
      <div
        ref={root}
        role="textbox"
        aria-label="Image proof"
        contentEditable
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
      {wrapper && <DecoratorRenderer editor={wrapper.editor} />}
    </>
  );
  return wrapper ? (
    <LexicalWrapperContext.Provider value={wrapper}>
      {content()}
    </LexicalWrapperContext.Provider>
  ) : (
    content()
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
