import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { MessageReferenceNavigation } from '@core/messages/message-reference-navigation';
import { $dfs } from '@lexical/utils';
import {
  $createAccountManagerRequestNode,
  $createAgentContextNode,
  $createAwaitNode,
  $createConnectAppNode,
  $createCursorSystemNotificationNode,
  $createGroupMentionNode,
  $createReplyTargetNode,
  $createThemeMentionNode,
  $createUnknownMentionNode,
  $createWatermarkNode,
  type ReplyTargetData,
} from '@macro-inc/lexical-core';
import { $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DEFAULT_THEMES } from '@theme/constants';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getRoot,
  $setSelection,
} from 'lexical';
import { getOwner, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import type { LexicalWrapper } from '../../context/LexicalWrapperContext';
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
import { theme } from '../../theme';
import { MARKDOWN_VERSION_COUNTER } from '../../version';
import { mountNativeSurface } from './native-surface';

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});

type FixtureKind =
  | 'watermark'
  | 'await'
  | 'agent-context'
  | 'reply-target'
  | 'account-manager-request'
  | 'system-notification'
  | 'group-mention'
  | 'unknown-mention'
  | 'theme-mention'
  | 'connect-app';
const candidate = new URLSearchParams(location.search).get('kind');
const kind: FixtureKind =
  candidate === 'watermark' ||
  candidate === 'await' ||
  candidate === 'agent-context' ||
  candidate === 'reply-target' ||
  candidate === 'account-manager-request' ||
  candidate === 'system-notification' ||
  candidate === 'unknown-mention' ||
  candidate === 'theme-mention' ||
  candidate === 'connect-app'
    ? candidate
    : 'group-mention';
const importTrace =
  new URLSearchParams(location.search).get('trace') === 'import';
interface Capture {
  model: string;
  dom: string;
  shadows: readonly string[];
}
declare global {
  interface Window {
    fastSelectionInput?: string;
    fastReplyNavigations?: ReplyTargetData[];
    fastSelectionFixture?: {
      snapshot(): Capture;
      trace(): {
        mode: 'factory' | 'import';
        beforeImportDecorators: number;
        firstObservation: 'after-import' | 'after-factory';
      };
      selectDecorator(): void;
      clearSelection(): void;
      importSavedSource?(): void;
    };
  }
}

function seedDocument() {
  const root = $getRoot();
  $setId(root, 'fast-decorator-root');
  if (kind === 'watermark') {
    root.append(
      $createParagraphNode().append(
        $createWatermarkNode({ content: 'Fixture watermark' })
      )
    );
  } else if (kind === 'await') {
    root.append(
      $createParagraphNode().append(
        $createAwaitNode({
          awaitId: 'fixture-await',
          text: 'Waiting for fixture',
          inline: true,
        })
      )
    );
  } else if (kind === 'agent-context') {
    root.append(
      $createAgentContextNode({ version: 1, text: 'Hidden fixture context' })
    );
  } else if (kind === 'reply-target') {
    root.append(
      $createReplyTargetNode({
        parent: { type: 'channel', id: 'fixture-channel' },
        targetMessageId: 'fixture-message',
        targetThreadId: 'fixture-thread',
        displayText: 'Fixture reply **content**',
        senderId: 'fixture-sender',
      })
    );
  } else if (kind === 'account-manager-request') {
    root.append(
      $createParagraphNode().append(
        $createAccountManagerRequestNode('fixture-grant')
      )
    );
  } else if (kind === 'system-notification') {
    root.append(
      $createCursorSystemNotificationNode({
        source: 'github',
        attributes: {
          subscriptionType: 'github:ci:branch',
          conclusion: 'success',
          checks: '3',
          branch: 'fixture-branch',
          extra: 'fixture-extra',
        },
        text: 'Fixture checks completed',
      })
    );
  } else if (kind === 'group-mention') {
    root.append(
      $createParagraphNode().append(
        $createGroupMentionNode({ groupAlias: 'fixture-group' })
      )
    );
  } else if (kind === 'unknown-mention') {
    root.append(
      $createParagraphNode().append(
        $createUnknownMentionNode({ name: 'Fixture unknown' })
      )
    );
  } else if (kind === 'theme-mention') {
    const preset = DEFAULT_THEMES[0];
    if (!preset) throw new Error('Missing actual default theme');
    root.append(
      $createParagraphNode().append(
        $createThemeMentionNode('Fixture theme', { ...preset })
      )
    );
  } else if (kind === 'connect-app') {
    root.append(
      $createParagraphNode().append(
        $createConnectAppNode('cursor', 'Cursor', 'harness')
      )
    );
  }
  for (const [index, { node }] of $dfs().slice(1).entries())
    $setId(node, `fast-decorator-${kind}-${index}`);
}
/** Wait for the actual metadata plugin commit, rather than normalize exported JSON. */
function seedActualSource(
  wrapper: LexicalWrapper,
  root: HTMLElement
): Promise<void> {
  wrapper.editor.setRootElement(root);
  return new Promise((resolve) => {
    const release = wrapper.editor.registerUpdateListener(({ editorState }) => {
      if (
        editorState.read(() => $getDocumentMetadata().version) ===
        MARKDOWN_VERSION_COUNTER
      ) {
        release();
        resolve();
      }
    });
    wrapper.editor.update(seedDocument, { discrete: true });
  });
}

function NativeFixture() {
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'fast-decorator-fixture',
    isInteractable: () => true,
    withIds: true,
    theme,
  });
  wrapper.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(documentMetadataPlugin({}));
  const owner = getOwner();
  let root: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;
  let closed = false;
  onMount(async () => {
    if (!root) throw new Error('Missing native fixture root');
    let model: string;
    if (importTrace) {
      if (typeof window.fastSelectionInput !== 'string')
        throw new Error('Missing frozen Source import input');
      model = window.fastSelectionInput;
    } else {
      const referenceRoot = document.createElement('div');
      await seedActualSource(wrapper, referenceRoot);
      if (closed) return;
      model = JSON.stringify(wrapper.editor.getEditorState().toJSON());
    }
    const surface = await mountNativeSurface(root, model, owner);
    if (closed) {
      surface.close();
      return;
    }
    dispose = () => surface.close();
    const element = root;
    window.fastSelectionFixture = {
      trace: () => ({
        mode: importTrace ? 'import' : 'factory',
        beforeImportDecorators: surface.beforeImportDecorators,
        firstObservation: 'after-import',
      }),
      selectDecorator() {
        surface.selectKind(kind);
      },
      clearSelection() {
        surface.clearSelection();
      },
      snapshot() {
        return {
          model: surface.serializedState(),
          dom: element.innerHTML,
          shadows: [...element.querySelectorAll('*')].flatMap((child) =>
            child.shadowRoot ? [child.shadowRoot.innerHTML] : []
          ),
        };
      },
    };
  });
  onCleanup(() => {
    closed = true;
    dispose?.();
    delete window.fastSelectionFixture;
    wrapper.editor.setRootElement(null);
    wrapper.cleanup();
  });
  return (
    <FloatingMenuGroup>
      <div
        ref={root}
        role="textbox"
        aria-label="Fast decorator fixture"
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
    </FloatingMenuGroup>
  );
}
function Fixture() {
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'fast-decorator-fixture',
    isInteractable: () => true,
    withIds: true,
    theme,
  });
  wrapper.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(documentMetadataPlugin({}));
  let root: HTMLDivElement | undefined;
  onMount(async () => {
    if (!root) throw new Error('Missing fixture root');
    let beforeImportDecorators = 0;
    if (importTrace) {
      if (typeof window.fastSelectionInput !== 'string')
        throw new Error('Missing frozen Source import input');
      wrapper.editor.setRootElement(root);
      beforeImportDecorators = root.querySelectorAll(
        '[data-lexical-decorator]'
      ).length;
      wrapper.editor.getEditorState().read(() => $getDocumentMetadata());
      const parsed = wrapper.editor.parseEditorState(window.fastSelectionInput);
      wrapper.editor.setEditorState(parsed);
    } else {
      await seedActualSource(wrapper, root);
    }
    const element = root;
    window.fastSelectionFixture = {
      trace: () => ({
        mode: importTrace ? 'import' : 'factory',
        beforeImportDecorators,
        firstObservation: importTrace ? 'after-import' : 'after-factory',
      }),
      importSavedSource() {
        const saved = JSON.stringify(wrapper.editor.getEditorState().toJSON());
        const parsed = wrapper.editor.parseEditorState(saved);
        wrapper.editor.setEditorState(parsed);
      },
      selectDecorator() {
        wrapper.editor.update(
          () => {
            const node = $dfs().find(
              (record) => record.node.getType() === kind
            )?.node;
            if (!node) throw new Error('Missing actual Source decorator');
            const selection = $createNodeSelection();
            selection.add(node.getKey());
            $setSelection(selection);
          },
          { discrete: true }
        );
      },
      clearSelection() {
        wrapper.editor.update(() => $setSelection(null), { discrete: true });
      },
      snapshot() {
        return {
          model: JSON.stringify(wrapper.editor.getEditorState().toJSON()),
          dom: element.innerHTML,
          shadows: [...element.querySelectorAll('*')].flatMap((child) =>
            child.shadowRoot ? [child.shadowRoot.innerHTML] : []
          ),
        };
      },
    };
  });
  onCleanup(() => {
    delete window.fastSelectionFixture;
    wrapper.editor.setRootElement(null);
    wrapper.cleanup();
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <FloatingMenuGroup>
        <div
          ref={root}
          role="textbox"
          aria-label="Fast decorator fixture"
          contentEditable
          class="md w-[640px] min-h-80 p-4 outline-none"
        />
        <DecoratorRenderer editor={wrapper.editor} />
      </FloatingMenuGroup>
    </LexicalWrapperContext.Provider>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture host');
window.fastReplyNavigations = [];
render(
  () => (
    <MessageReferenceNavigation.Provider
      value={(target) => {
        window.fastReplyNavigations?.push(target);
        return true;
      }}
    >
      <AnalyticsContextProvider>
        <PosthogProvider>
          <QueryClientProvider client={queryClient}>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <MobileSettingsProvider>
                  <MemoryRouter>
                    <Route
                      path="*"
                      component={
                        new URLSearchParams(location.search).get('engine') ===
                        'native'
                          ? NativeFixture
                          : Fixture
                      }
                    />
                  </MemoryRouter>
                </MobileSettingsProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </QueryClientProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </MessageReferenceNavigation.Provider>
  ),
  root
);
