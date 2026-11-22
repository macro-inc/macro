import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { SERVER_HOSTS } from '@core/constant/servers';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { $dfs } from '@lexical/utils';
import {
  $createEquationNode,
  $createImageNode,
  $createUserMentionNode,
  $isImageNode,
  EquationNode,
} from '@macro-inc/lexical-core';
import { $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $nodesOfType,
} from 'lexical';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { FloatingEquationMenu } from '../../component/menu/FloatingEquationMenu';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { initializeLexical } from '../../init';
import { mediaPlugin } from '../../plugins/media';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { theme } from '../../theme';

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});

declare global {
  interface Window {
    decoratorFixture?: {
      debug?(): unknown;
      snapshot(): {
        model: unknown;
        image: unknown;
        equation: string;
        inline: boolean;
      };
    };
  }
}

function seedDocument() {
  $getRoot().append(
    $createParagraphNode().append(
      $createUserMentionNode({
        userId: 'macro|user@example.com',
        email: 'user@example.com',
        displayName: 'Fixture User',
      })
    ),
    $createImageNode({
      srcType: 'url',
      url: `${SERVER_HOSTS['static-file']}/file/decorator-fixture.svg`,
      alt: 'Fixture image',
      width: 256,
      height: 128,
      scale: 1,
    }),
    $createParagraphNode().append($createEquationNode('x^2', false)),
    $createParagraphNode().append($createTextNode('Footer'))
  );
  for (const [index, { node }] of $dfs().slice(1).entries()) {
    $setId(node, `decorator-fixture-node-${index}`);
  }
}

function domSelectionFacts() {
  const selection = document.getSelection();
  return {
    rangeCount: selection?.rangeCount,
    anchorName: selection?.anchorNode?.nodeName,
    anchorText: selection?.anchorNode?.textContent,
    anchorOffset: selection?.anchorOffset,
    focusName: selection?.focusNode?.nodeName,
    focusOffset: selection?.focusOffset,
  };
}

function Fixture() {
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'decorator-fixture',
    isInteractable: () => true,
    withIds: true,
    theme,
  });
  wrapper.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(mediaPlugin());
  const events: unknown[] = [];
  const selection = () =>
    wrapper.editor.getEditorState().read(() => {
      const current = $getSelection();
      if ($isNodeSelection(current))
        return {
          kind: 'node',
          keys: current.getNodes().map((node) => node.getKey()),
        };
      if ($isRangeSelection(current))
        return {
          kind: 'range',
          anchor: {
            key: current.anchor.key,
            offset: current.anchor.offset,
            type: current.anchor.type,
          },
          focus: {
            key: current.focus.key,
            offset: current.focus.offset,
            type: current.focus.type,
          },
        };
      return { kind: 'none' };
    });
  let root: HTMLDivElement | undefined;
  onMount(() => {
    if (!root) throw new Error('Missing editor root');
    wrapper.editor.setRootElement(root);
    wrapper.editor.update(
      () => {
        seedDocument();
      },
      { discrete: true }
    );
    const release = wrapper.editor.registerUpdateListener(() => {
      events.push({
        event: 'commit',
        selection: selection(),
        dom: domSelectionFacts(),
      });
    });
    const change = () => {
      events.push({
        event: 'selectionchange',
        selection: selection(),
        dom: domSelectionFacts(),
      });
    };
    document.addEventListener('selectionchange', change);
    onCleanup(() => {
      release();
      document.removeEventListener('selectionchange', change);
    });
    window.decoratorFixture = {
      debug() {
        return { selection: selection(), dom: domSelectionFacts(), events };
      },
      snapshot() {
        return wrapper.editor.getEditorState().read(() => {
          const image = $dfs()
            .map(({ node }) => node)
            .find($isImageNode);
          const equation = $nodesOfType(EquationNode)[0];
          if (!image || !equation)
            throw new Error('Missing fixture decorators');
          return {
            model: wrapper.editor.getEditorState().toJSON(),
            image: image.exportJSON(),
            equation: equation.getEquation(),
            inline: equation.getInline(),
          };
        });
      },
    };
  });
  onCleanup(() => {
    delete window.decoratorFixture;
    wrapper.editor.setRootElement(null);
    wrapper.cleanup();
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <FloatingMenuGroup>
        <div
          ref={root}
          role="textbox"
          aria-label="Decorator fixture"
          contentEditable
          class="md w-[640px] min-h-80 p-4 outline-none"
        />
        <DecoratorRenderer editor={wrapper.editor} />
        <FloatingEquationMenu canEdit={() => true} />
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
