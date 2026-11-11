import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { handleFileFolderDrop } from '@core/util/upload';
import { CodeNode } from '@lexical/code-core';
import { $dfs } from '@lexical/utils';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  $createImageNode,
  $createVideoNode,
  $isImageNode,
  $isVideoNode,
} from '@macro-inc/lexical-core';
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
import { filePastePlugin } from '../../plugins/file-paste';
import { dispatchApplicationCommandSettled } from '../../plugins/group-b/command';
import { addMediaFromFile, mediaPlugin } from '../../plugins/media';
import { createNativeImageUploadController } from '../../plugins/media/native-image-upload';
import { createNativeMediaUploadEvents } from '../../plugins/media/native-upload-events';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph/trailingParagraphPlugin';
import { theme } from '../../theme';
import { createNativeImageContext } from '../native-image-host';
import { createNativeImageDecoratorViews } from '../native-image-views';
import {
  createNativeVideoContext,
  createNativeVideoDecoratorViews,
} from '../native-video-views';
import initialize, { EditorSession } from './wasm/document_session_wasm.js';

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});
interface KeyAdmission {
  key: string;
  cached: string;
  submitted: string;
}

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
      keyAdmissions(): readonly KeyAdmission[];
      setUrl(url: string, rerender: boolean): Promise<void>;
      close(): Promise<void>;
    };
  }
}
function Fixture() {
  const params = new URLSearchParams(location.search);
  const engine = params.get('engine');
  const uploadMode = params.has('upload');
  const videoMode = params.has('video');
  const kind = videoMode ? 'video' : 'image';
  const namespace = videoMode ? 'video-fixture' : 'image-fixture';
  if (uploadMode && CodeNode.getType() !== 'code')
    throw new Error('Missing pinned Source code module');
  const owner = getOwner();
  const wrapper =
    engine === 'native'
      ? undefined
      : createLexicalWrapper({
          type: 'markdown-sync',
          namespace,
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
  if (wrapper && uploadMode) {
    wrapper.plugins.use(
      filePastePlugin({
        onPasteFilesAndDirs(files, directories) {
          handleFileFolderDrop(files, directories, async (entries) => {
            for (const entry of entries) {
              if (!entry.isFolder)
                await addMediaFromFile(wrapper.editor, entry.file, 'image');
            }
          }).catch((error: unknown) => console.error(error));
        },
      })
    );
  }
  const controller =
    engine === 'native' && uploadMode
      ? createNativeImageUploadController()
      : undefined;
  const uploads = controller?.events ?? createNativeMediaUploadEvents();
  const nativeContext =
    engine === 'native' && !videoMode
      ? createNativeImageContext(theme, () => true, uploads)
      : undefined;
  const videoContext =
    engine === 'native' && videoMode
      ? createNativeVideoContext(theme, () => true, uploads)
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
        videoContext?.dispose();
        if (controller) controller.dispose();
        else uploads.dispose();
      }
    })();
    return closing;
  };
  window.imageProofClose = closeOnce;
  onMount(async () => {
    if (!root) throw new Error('Missing Image proof root');
    const element = root;
    const keyAdmissions: KeyAdmission[] = [];
    let model: () => string;
    let setUrl: (url: string, rerender: boolean) => Promise<void>;
    if (engine === 'native') {
      if (typeof window.imageProofInput !== 'string')
        throw new Error('Missing frozen import input');
      await initialize();
      if (closing) return;
      const registry = registerMacroElementViews(createBuiltinRegistry());
      if (videoContext) {
        registerMacroDecoratorViews(
          registry,
          createNativeVideoDecoratorViews(videoContext)
        );
      } else if (nativeContext) {
        registerMacroDecoratorViews(
          registry,
          createNativeImageDecoratorViews(nativeContext)
        );
      } else {
        throw new Error('Missing actual media context');
      }
      const surface = mountLocalSessionView(
        element,
        registry,
        {
          namespace,
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
              namespace
            ),
        }
      );
      close = async () => {
        controller?.dispose();
        nativeContext?.dispose();
        videoContext?.dispose();
        await surface.close();
      };
      if (element.querySelector('[data-lexical-decorator]'))
        throw new Error('Observed native decorator before import');
      controller?.bindView(surface.view);
      surface.port.setState(window.imageProofInput);
      const keyDown = surface.port.keyDown.bind(surface.port);
      surface.port.keyDown = (...args) => {
        const [, , , key, selection] = args;
        if (key === 'Backspace' || key === 'Delete') {
          keyAdmissions.push({
            key,
            cached: surface.view.selection().selection.kind,
            submitted: selection.kind,
          });
        }
        return keyDown(...args);
      };
      model = () => surface.executor.session.serializedState();
      setUrl = async (url, rerender) => {
        const media = [...surface.view.mirror.values()].find(
          (node) => node.type === kind
        );
        if (!media) throw new Error('Missing actual native media');
        const outcome = await dispatchApplicationCommandSettled(
          surface.view,
          'group-b.media-set-property',
          {
            key: media.key,
            kind,
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
            if (videoMode) {
              node.append(
                $createVideoNode({
                  srcType: 'url',
                  url: new URL(
                    '/src/features/block-pptx/browser-test/fixtures/clip.webm',
                    location.origin
                  ).href,
                  width: 320,
                  height: 180,
                  controls: false,
                })
              );
            } else if (!uploadMode)
              node.append(
                $createImageNode({
                  srcType: 'url',
                  url: 'https://static.klipy.com/fixture/image.svg',
                  alt: 'Fixture image',
                  width: 256,
                  height: 128,
                })
              );
            node.append($createParagraphNode());
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
            const node = $getRoot().getFirstChild();
            if (
              !node ||
              !($isImageNode(node) || $isVideoNode(node)) ||
              node.getType() !== kind
            )
              throw new Error('Missing actual Source media');
            node.setUrl(url, rerender);
          },
          { discrete: true }
        );
      };
    }
    window.imageProofFixture = {
      keyAdmissions: () => keyAdmissions,
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
        aria-label={videoMode ? 'Video proof' : 'Image proof'}
        contentEditable
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
      {wrapper && <DecoratorRenderer editor={wrapper.editor} />}
      {uploadMode && (
        <>
          <input
            type="file"
            aria-label="Image file"
            accept="image/*"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              const result = controller
                ? controller.insertFile(file)
                : wrapper && addMediaFromFile(wrapper.editor, file, 'image');
              result?.catch((error: unknown) => console.error(error));
            }}
          />
          <ToastRegion />
        </>
      )}
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
