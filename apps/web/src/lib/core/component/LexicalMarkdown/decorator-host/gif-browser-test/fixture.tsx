import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import initialize, {
  EditorSession,
} from '@core/document-session/wasm/document_session_wasm.js';
import { CodeNode } from '@lexical/code-core';
import { $dfs } from '@lexical/utils';
import {
  ABI_MAJOR,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { $getId, $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { mountLocalSessionView } from '@macro-inc/lexical-wasm-view';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import type { Point } from '@macro-inc/lexical-wasm-view/view/types';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
  RootNode,
} from 'lexical';
import { getOwner, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import {
  FloatingGifMenu,
  HostedFloatingGifMenu,
} from '../../component/menu/FloatingGifMenu';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { createLexicalGifMenuHost } from '../../editing/overlay-hosts/lexical-gif';
import { initializeLexical } from '../../init';
import {
  $getDocumentMetadata,
  documentMetadataPlugin,
} from '../../plugins/document-metadata/documentMetadataPlugin';
import { TRY_INSERT_GIF_COMMAND } from '../../plugins/gif';
import { createNativeMediaUploadEvents } from '../../plugins/media/native-upload-events';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph/trailingParagraphPlugin';
import { theme } from '../../theme';
import { createNativeImageContext } from '../native-image-host';
import { createNativeImageDecoratorViews } from '../native-image-views';

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
  panels: readonly string[];
  shadows: readonly string[];
}
declare global {
  interface Window {
    gifProofInput?: string;
    gifProofClose?: () => Promise<void>;
    gifProofFixture?: {
      capture(): Capture;
      open?: () => boolean;
      completeSourceCommits?: () => void;
      pendingSourceCommits?: () => number;
      select(): Promise<void>;
      probeCommitError?: () => Promise<
        | {
            kind: 'settled';
            settlement: InputSettlement;
            after: readonly boolean[];
            model: string;
            sameError: boolean;
          }
        | {
            kind: 'synchronousThrow';
            after: readonly boolean[];
            model: string;
            sameError: boolean;
          }
      >;
    };
  }
}

function Fixture() {
  if (CodeNode.getType() !== 'code')
    throw new Error('Missing actual Source code module');
  const asyncSource = new URLSearchParams(location.search).has('asyncSource');
  const engine =
    new URLSearchParams(location.search).get('engine') ?? 'lexical';
  const wrapper =
    engine === 'native'
      ? undefined
      : createLexicalWrapper({
          type: 'markdown-sync',
          namespace: 'gif-fixture',
          isInteractable: () => true,
          withIds: true,
          theme,
        });
  wrapper?.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(trailingParagraphPlugin())
    .use(documentMetadataPlugin({}));
  const pendingCommits = new Set<() => void>();
  const sourceHost = wrapper
    ? createLexicalGifMenuHost(
        () => wrapper.editor,
        () => wrapper.plugins
      )
    : undefined;
  const asynchronousSourceHost = sourceHost
    ? {
        ...sourceHost,
        commit(...args: Parameters<typeof sourceHost.commit>) {
          const result = sourceHost.commit(...args);
          if (typeof result !== 'boolean')
            throw new Error('Actual Source commit was not synchronous');
          return new Promise<boolean>((resolve) => {
            const complete = () => {
              pendingCommits.delete(complete);
              resolve(result);
            };
            pendingCommits.add(complete);
          });
        },
      }
    : undefined;
  let fixtureId = 0;
  const assignFixtureId = (node: LexicalNode) => {
    const id = $getId(node);
    if (id?.startsWith('gif-fixture-') || id?.startsWith('gif-created-'))
      return;
    $setId(node, `gif-created-${fixtureId++}`);
  };
  const stopFixtureIds = wrapper
    ? [
        wrapper.editor.registerNodeTransform(RootNode, () => {
          for (const { node } of $dfs()) assignFixtureId(node);
        }),
      ]
    : [];
  const uploads =
    engine === 'native' ? createNativeMediaUploadEvents() : undefined;
  const native = uploads
    ? createNativeImageContext(theme, () => true, uploads)
    : undefined;
  const owner = getOwner();
  let root: HTMLDivElement | undefined;
  let close: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const closeOnce = () =>
    (closing ??= (async () => {
      try {
        await close?.();
      } finally {
        native?.dispose();
        for (const complete of pendingCommits) complete();
        stopFixtureIds.forEach((stop) => stop());
        uploads?.dispose();
      }
    })());
  window.gifProofClose = closeOnce;
  onMount(async () => {
    if (!root) throw new Error('Missing GIF editor root');
    const element = root;
    let model: () => string;
    let select: () => Promise<void>;
    let open: (() => boolean) | undefined;
    let probeCommitError: NonNullable<
      Window['gifProofFixture']
    >['probeCommitError'];
    if (engine === 'native') {
      if (!native || !window.gifProofInput)
        throw new Error('Missing actual native import');
      await initialize();
      if (closing) return;
      const registry = registerMacroElementViews(createBuiltinRegistry());
      registerMacroDecoratorViews(
        registry,
        createNativeImageDecoratorViews(native)
      );
      const surface = mountLocalSessionView(
        element,
        registry,
        {
          namespace: 'gif-fixture',
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
              'gif-fixture'
            ),
        }
      );
      close = async () => {
        native.dispose();
        await surface.close();
      };
      surface.port.setState(window.gifProofInput);
      model = () => surface.executor.session.serializedState();
      select = async () => {
        const text = [...surface.view.mirror.values()].find(
          (node) => node.kind === 'text' && node.text === 'beforeafter'
        );
        if (!text) throw new Error('Missing actual native anchor');
        const point: Point = { key: text.key, offset: 6, type: 'text' };
        const selection = selectionMessage({
          kind: 'range',
          anchor: point,
          focus: point,
        });
        const outcome = await surface.port.inputSettled(
          EditorInputMsg.fromEditorSelection({ selection, change: {} })
        );
        if (outcome.status !== 'success')
          throw new Error('Actual selection failed');
      };
      probeCommitError = async () => {
        const after: boolean[] = [];
        const failure = new Error('GIF commit observer failed');
        let stop: (() => void) | undefined;
        stop = surface.view.onCommit((commit) => {
          if (
            [...commit.mutations.values()].some(
              (mutation) => mutation.after?.type === 'image'
            )
          ) {
            stop?.();
            throw failure;
          }
        });
        try {
          const settlement = await surface.port.inputSettled(
            () => {
              const generation = surface.view.mirror.keyGeneration;
              if (generation === null)
                throw new Error('Missing actual generation');
              return {
                name: 'group-b.media',
                json: JSON.stringify({
                  action: 'insert',
                  kind: 'image',
                  media: {
                    srcType: 'sfs',
                    id: '00000000-0000-4000-8000-000000000031',
                    url: 'https://example.test/committed.gif',
                  },
                }),
                generation,
                selection: selectionMessage({ kind: 'keep' }),
              };
            },
            { after: (handled) => after.push(handled) }
          );
          return {
            kind: 'settled',
            settlement,
            after,
            model: model(),
            sameError:
              settlement.status === 'error' && settlement.error === failure,
          };
        } catch (error) {
          return {
            kind: 'synchronousThrow',
            after,
            model: model(),
            sameError: error === failure,
          };
        } finally {
          stop?.();
        }
      };
    } else {
      if (!wrapper) throw new Error('Missing actual Source editor');
      close = async () => {
        wrapper.editor.setRootElement(null);
        wrapper.cleanup();
      };
      wrapper.editor.setRootElement(element);
      if (engine === 'factory')
        wrapper.editor.update(
          () => {
            $getRoot()
              .clear()
              .append(
                $createParagraphNode().append($createTextNode('beforeafter'))
              );
            $getDocumentMetadata();
            $dfs().forEach(({ node }, index) =>
              $setId(node, `gif-fixture-${index}`)
            );
          },
          { discrete: true }
        );
      else {
        if (!window.gifProofInput)
          throw new Error('Missing frozen Source import');
        wrapper.editor.setEditorState(
          wrapper.editor.parseEditorState(window.gifProofInput)
        );
        wrapper.editor.read(() => $getDocumentMetadata());
      }
      model = () => JSON.stringify(wrapper.editor.getEditorState().toJSON());
      select = async () =>
        wrapper.editor.update(
          () => {
            const paragraph = $getRoot().getFirstChildOrThrow();
            if (!$isElementNode(paragraph))
              throw new Error('Missing actual Source paragraph');
            const text = paragraph.getFirstDescendant();
            if (!$isTextNode(text)) throw new Error('Missing Source anchor');
            text.select(6, 6);
          },
          { discrete: true }
        );
      open = () =>
        wrapper.editor.dispatchCommand(TRY_INSERT_GIF_COMMAND, undefined);
    }
    window.gifProofFixture = {
      capture: () => ({
        model: model(),
        dom: element.outerHTML,
        panels: [
          ...document.querySelectorAll(
            '[data-holds-prompts][data-keep-keyboard]'
          ),
        ].map((node) => node.outerHTML),
        shadows: [...element.querySelectorAll('*')].flatMap((node) =>
          node.shadowRoot ? [node.shadowRoot.innerHTML] : []
        ),
      }),
      select,
      open,
      probeCommitError,
      completeSourceCommits: sourceHost
        ? () => {
            for (const complete of pendingCommits) complete();
          }
        : undefined,
      pendingSourceCommits: sourceHost ? () => pendingCommits.size : undefined,
    };
  });
  onCleanup(() => {
    delete window.gifProofFixture;
    delete window.gifProofClose;
    closeOnce().catch((error) => console.error(error));
  });
  const content = () => (
    <FloatingMenuGroup>
      <div
        ref={root}
        role="textbox"
        aria-label="GIF proof"
        contentEditable
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
      {wrapper && (
        <>
          <DecoratorRenderer editor={wrapper.editor} />
          {asyncSource && asynchronousSourceHost ? (
            <HostedFloatingGifMenu
              host={asynchronousSourceHost}
              canEdit={() => true}
            />
          ) : (
            <FloatingGifMenu canEdit={() => true} />
          )}
        </>
      )}
      <button type="button" onClick={() => window.gifProofFixture?.open?.()}>
        Open GIF
      </button>
    </FloatingMenuGroup>
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
if (!root) throw new Error('Missing GIF fixture host');
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
