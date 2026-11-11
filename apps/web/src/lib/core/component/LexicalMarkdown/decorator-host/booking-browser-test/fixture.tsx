import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { CodeNode } from '@lexical/code-core';
import { $dfs } from '@lexical/utils';
import {
  $createBookingLinkMentionNode,
  BookingLinkMentionNode,
} from '@macro-inc/lexical-core';
import { $getId, $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  $setSelection,
  KEY_ENTER_COMMAND,
  RootNode,
} from 'lexical';
import { onCleanup, onMount, Show } from 'solid-js';
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
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { trailingParagraphPlugin } from '../../plugins/trailing-paragraph/trailingParagraphPlugin';
import { theme } from '../../theme';

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
  portals: readonly string[];
  tags: readonly (readonly string[])[];
}
declare global {
  interface Window {
    bookingProofInput?: string;
    bookingProofClose?: () => void;
    bookingProof?: { capture(): Capture; select(): void; enter(): boolean };
  }
}

function Fixture() {
  if (CodeNode.getType() !== 'code')
    throw new Error('Missing pristine Source code module');
  const params = new URLSearchParams(location.search);
  const factory = params.get('engine') === 'factory';
  const variant = params.get('case') ?? 'label';
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'booking-fixture',
    isInteractable: () => true,
    withIds: true,
    theme,
  });
  wrapper.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(trailingParagraphPlugin())
    .use(documentMetadataPlugin({}));
  let nextId = 0;
  const stopIds = wrapper.editor.registerNodeTransform(RootNode, () => {
    for (const { node } of $dfs())
      if (!$getId(node)?.startsWith('booking-fixture-'))
        $setId(node, `booking-fixture-${nextId++}`);
  });
  const tags: string[][] = [];
  const stopUpdates = wrapper.editor.registerUpdateListener((update) => {
    tags.push([...update.tags]);
  });
  let element: HTMLDivElement | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    delete window.bookingProof;
    delete window.bookingProofClose;
    try {
      stopUpdates();
    } finally {
      try {
        stopIds();
      } finally {
        try {
          wrapper.editor.setRootElement(null);
        } finally {
          wrapper.cleanup();
        }
      }
    }
  };
  window.bookingProofClose = close;
  onMount(() => {
    if (!element) throw new Error('Missing booking root');
    const root = element;
    wrapper.editor.setRootElement(root);
    if (factory) {
      wrapper.editor.update(
        () => {
          const node = $createBookingLinkMentionNode({
            profileId: 'fixture-profile',
            url:
              variant === 'generic'
                ? 'https://example.test/booking'
                : 'https://macro.com/app/book/fixture-profile/url-slug',
            ...(variant === 'label' || variant === 'null'
              ? { label: 'Saved label' }
              : {}),
            ...(variant === 'slug' || variant === 'null'
              ? { slug: 'supplied-slug' }
              : {}),
            ...(variant === 'blank' ? { label: ' ' } : {}),
            ...(variant === 'empty' ? { label: '' } : {}),
          });
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append(
                $createTextNode('Before '),
                node,
                $createTextNode(' after')
              )
            );
          $getDocumentMetadata();
        },
        { discrete: true }
      );
    } else {
      if (!window.bookingProofInput)
        throw new Error('Missing literal Source booking import');
      wrapper.editor.setEditorState(
        wrapper.editor.parseEditorState(window.bookingProofInput)
      );
      wrapper.editor.read(() => $getDocumentMetadata());
    }
    tags.length = 0;
    window.bookingProof = {
      capture: () => ({
        model: JSON.stringify(wrapper.editor.getEditorState().toJSON()),
        dom: root.outerHTML,
        portals: [...document.body.children]
          .filter((node) => node.id !== 'root' && node.tagName !== 'SCRIPT')
          .map((node) => node.outerHTML),
        tags: tags.map((row) => [...row]),
      }),
      select() {
        wrapper.editor.update(
          () => {
            const node = $nodesOfType(BookingLinkMentionNode)[0];
            if (!node) throw new Error('Missing actual Source booking node');
            const selection = $createNodeSelection();
            selection.add(node.getKey());
            $setSelection(selection);
          },
          { discrete: true }
        );
      },
      enter: () => wrapper.editor.dispatchCommand(KEY_ENTER_COMMAND, null),
    };
  });
  onCleanup(close);
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <div
        ref={element}
        role="textbox"
        aria-label="Booking proof"
        contentEditable
        class="md w-[640px] min-h-80 p-4 outline-none"
      />
      <Show when={!factory}>
        <DecoratorRenderer editor={wrapper.editor} />
      </Show>
    </LexicalWrapperContext.Provider>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing booking fixture host');
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
