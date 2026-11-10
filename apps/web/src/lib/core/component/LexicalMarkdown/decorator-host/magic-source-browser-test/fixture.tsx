import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { $dfs } from '@lexical/utils';
import { $createMagicChipNode } from '@macro-inc/lexical-core';
import { $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { $createNodeSelection, $getRoot, $setSelection } from 'lexical';
import { onCleanup, onMount } from 'solid-js';
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

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});

const kind = 'magic-chip';
const importTrace =
  new URLSearchParams(location.search).get('trace') === 'import';
interface Capture {
  model: string;
  dom: string;
  shadows: readonly string[];
}
declare global {
  interface Window {
    magicSourceInput?: string;
    magicSourceFixture?: {
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
  root.append(
    $createMagicChipNode({
      agentSessionId: 'fixture-agent',
      promptedMessage: null,
      status: 'no_messages',
    })
  );
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
      if (typeof window.magicSourceInput !== 'string')
        throw new Error('Missing frozen Source import input');
      wrapper.editor.setRootElement(root);
      beforeImportDecorators = root.querySelectorAll(
        '[data-lexical-decorator]'
      ).length;
      wrapper.editor.getEditorState().read(() => $getDocumentMetadata());
      const parsed = wrapper.editor.parseEditorState(window.magicSourceInput);
      wrapper.editor.setEditorState(parsed);
    } else {
      await seedActualSource(wrapper, root);
    }
    const element = root;
    window.magicSourceFixture = {
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
    delete window.magicSourceFixture;
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
