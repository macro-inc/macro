import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import initialize, * as native from '@core/document-session/wasm/document_session_wasm.js';
import { $dfs } from '@lexical/utils';
import {
  ABI_MAJOR,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  $createPullRequestMentionNode,
  $createSnapshotNode,
  PullRequestMentionNode,
  SnapshotNode,
} from '@macro-inc/lexical-core';
import { $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { mountLocalSessionView } from '@macro-inc/lexical-wasm-view';
import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
  $setSelection,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { getOwner, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
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
import {
  createNativePullRequestMentionContext,
  createNativePullRequestMentionViews,
} from '../native-pr-mention-views';
import {
  createNativeSnapshotContext,
  createNativeSnapshotViews,
} from '../native-snapshot-views';

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});
queryClient.setQueryData(authKeys.githubLinkStatus.queryKey, {
  status: 'linked',
});
queryClient.setQueryData(previewKeys.item('reference-document').queryKey, {
  id: 'reference-document',
  type: 'document',
  access: 'access',
  loading: false,
  name: 'Snapshot fixture',
  rawName: 'Snapshot fixture',
  fileType: 'md',
  updatedAt: '2020-01-01T00:00:00.000Z',
  documentMetadata: { properties: [], canEdit: true },
});
interface Capture {
  model: string;
  dom: string;
  shadows: readonly string[];
  popups: readonly string[];
}
declare global {
  interface Window {
    referenceProofInput?: string;
    referenceProofInitializing?: Promise<unknown>;
    referenceProofClose?: () => Promise<void>;
    referenceProofFixture?: {
      snapshot(): Capture;
      select(): Promise<void>;
      enter(): boolean;
      close(): Promise<void>;
    };
  }
}
function Fixture() {
  const params = new URLSearchParams(location.search);
  const engine = params.get('engine');
  const kind = params.get('kind');
  if (kind !== 'pr-mention' && kind !== 'snapshot')
    throw new Error('Missing reference kind');
  const clearBeforeEnter = params.get('before-enter') === 'clear-selection';
  const owner = getOwner();
  const wrapper =
    engine === 'native'
      ? undefined
      : createLexicalWrapper({
          type: 'markdown-sync',
          namespace: 'reference-fixture',
          isInteractable: () => true,
          withIds: true,
          theme,
        });
  wrapper?.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(trailingParagraphPlugin())
    .use(documentMetadataPlugin({}));
  const prContext =
    engine === 'native' && kind === 'pr-mention'
      ? createNativePullRequestMentionContext(theme)
      : undefined;
  const snapshotContext =
    engine === 'native' && kind === 'snapshot'
      ? createNativeSnapshotContext(theme)
      : undefined;
  const referenceContext = prContext ?? snapshotContext;
  let select: (() => Promise<void>) | undefined;
  let enter: (() => boolean) | undefined;
  const releaseEarlier = wrapper?.editor.registerCommand(
    KEY_ENTER_COMMAND,
    () => {
      if (clearBeforeEnter) $setSelection(null);
      return false;
    },
    2
  );
  let root: HTMLDivElement | undefined;
  let close: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const closeOnce = () => {
    closing ??= (async () => {
      try {
        await close?.();
      } finally {
        releaseEarlier?.();
        referenceContext?.dispose();
      }
    })();
    return closing;
  };
  window.referenceProofClose = closeOnce;
  onMount(async () => {
    if (!root) throw new Error('Missing Reference proof root');
    const element = root;
    let model: () => string;
    if (engine === 'native') {
      if (typeof window.referenceProofInput !== 'string')
        throw new Error('Missing frozen import input');
      const initializing = initialize();
      window.referenceProofInitializing = initializing;
      await initializing;
      if (closing) return;
      if (!referenceContext)
        throw new Error('Missing actual Reference context');
      const registry = registerMacroElementViews(createBuiltinRegistry());
      registerMacroDecoratorViews(
        registry,
        prContext
          ? createNativePullRequestMentionViews(prContext)
          : snapshotContext
            ? createNativeSnapshotViews(snapshotContext)
            : {}
      );
      const surface = mountLocalSessionView(
        element,
        registry,
        {
          namespace: 'reference-fixture',
          theme,
          editable: true,
          preset: 'rich',
          owner: owner ?? undefined,
          onError(error) {
            throw error;
          },
        },
        {
          nativeCommands: native,
          viewEngine: /Firefox/.test(navigator.userAgent)
            ? 3
            : /AppleWebKit/.test(navigator.userAgent) &&
                !/Chrome/.test(navigator.userAgent)
              ? 2
              : 1,
          viewOs: 0,
          create: (config, now, wall) =>
            native.EditorSession.createMacroWithNamespace(
              ABI_MAJOR,
              config,
              now,
              wall,
              'reference-fixture'
            ),
        }
      );
      let releaseFirst: (() => void) | undefined;
      close = async () => {
        releaseFirst?.();
        referenceContext.dispose();
        await surface.close();
      };
      const command = createViewCommand(
        'Key(Enter)',
        (value): value is KeyboardEvent | null =>
          value === null || value instanceof KeyboardEvent
      );
      releaseFirst = surface.view.registerViewCommand(
        command,
        () => {
          if (clearBeforeEnter)
            surface.port.selectionFromView({ kind: 'none' });
          return false;
        },
        2
      );
      select = async () => {
        const reference = [...surface.view.mirror.values()].find(
          (node) => node.type === kind
        );
        if (!reference) throw new Error('Missing actual native Reference');
        const settled = await surface.port.inputSettled(
          EditorInputMsg.fromEditorSelection({
            selection: selectionMessage({
              kind: 'node',
              keys: [reference.key],
            }),
            change: {},
          })
        );
        if (settled.status !== 'success')
          throw settled.status === 'error'
            ? settled.error
            : new Error('Selection input cancelled');
      };
      enter = () => {
        const slot = surface.port.nativeEnter;
        if (!slot) throw new Error('Missing real Normal Enter slot');
        return slot.dispatch();
      };
      if (element.querySelector('[data-lexical-decorator]'))
        throw new Error('Observed native decorator before import');
      surface.port.setState(window.referenceProofInput);
      model = () => surface.executor.session.serializedState();
    } else {
      if (!wrapper) throw new Error('Missing actual Source wrapper');
      close = async () => {
        releaseEarlier?.();
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
            $setId(node, 'reference-proof-root');
            node.append(
              $createParagraphNode().append(
                kind === 'pr-mention'
                  ? $createPullRequestMentionNode({
                      id: 'reference-pr',
                      label: 'Original PR',
                      mentionUuid: 'reference-instance',
                    })
                  : $createSnapshotNode({
                      documentId: 'reference-document',
                      documentName: 'Snapshot fixture',
                      blockName: 'md',
                      content: 'Saved snapshot text',
                      snapshotDate: '2020-01-01T00:00:00.000Z',
                      mentionUuid: 'reference-snapshot',
                    })
              ),
              $createParagraphNode()
            );
            for (const [index, { node: child }] of $dfs().slice(1).entries())
              $setId(child, `reference-proof-${index}`);
          },
          { discrete: true }
        );
      } else {
        if (typeof window.referenceProofInput !== 'string')
          throw new Error('Missing frozen import input');
        wrapper.editor.getEditorState().read(() => $getDocumentMetadata());
        wrapper.editor.setEditorState(
          wrapper.editor.parseEditorState(window.referenceProofInput)
        );
      }
      model = () => JSON.stringify(wrapper.editor.getEditorState().toJSON());
      select = async () => {
        wrapper.editor.update(
          () => {
            const node =
              kind === 'pr-mention'
                ? $nodesOfType(PullRequestMentionNode)[0]
                : $nodesOfType(SnapshotNode)[0];
            if (!node) throw new Error('Missing actual Source Reference');
            const selection = $createNodeSelection();
            selection.add(node.getKey());
            $setSelection(selection);
          },
          { discrete: true }
        );
      };
      enter = () => {
        let handled = false;
        wrapper.editor.update(
          () => {
            handled = wrapper.editor.dispatchCommand(KEY_ENTER_COMMAND, null);
          },
          { discrete: true }
        );
        return handled;
      };
    }
    if (!select || !enter) throw new Error('Missing actual Reference controls');
    window.referenceProofFixture = {
      select,
      enter,
      snapshot() {
        return {
          model: model(),
          dom: element.innerHTML,
          popups: [
            ...document.querySelectorAll('[data-kb-popper-content-wrapper]'),
          ].map((node) => node.outerHTML),
          shadows: [...element.querySelectorAll('*')].flatMap((child) =>
            child.shadowRoot ? [child.shadowRoot.innerHTML] : []
          ),
        };
      },
      close: closeOnce,
    };
  });
  onCleanup(() => {
    delete window.referenceProofFixture;
    delete window.referenceProofClose;
    delete window.referenceProofInitializing;
    closeOnce().catch((error) => console.error(error));
  });
  const content = () => (
    <FloatingMenuGroup>
      <div
        ref={root}
        role="textbox"
        aria-label="Reference proof"
        contentEditable
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
      {wrapper && <DecoratorRenderer editor={wrapper.editor} />}
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
