import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess';
import { UserContextProvider } from '@core/context/user';
import initialize, * as nativeModule from '@core/document-session/wasm/document_session_wasm.js';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import { EntityProvider } from '@entity';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { $createParagraphNode, $getRoot } from 'lexical';
import { getOwner, onCleanup, onMount } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { MentionsMenu } from '../../component/menu/MentionsMenu';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { createNativeUserMentionContext } from '../../decorator-host/native-user-mention-host';
import { createNativeUserMentionViews } from '../../decorator-host/native-user-mention-views';
import { initializeLexical } from '../../init';
import { mentionsPlugin } from '../../plugins/mentions/mentionsPlugin';
import { createMenuOperations } from '../../shared/inlineMenu';
import { theme } from '../../theme';
import { installNativeMarkdownOverlays } from '../installNativeMarkdownOverlays';
import { createNativeUserMentionMenuHost } from '../overlay-hosts/native-user-mention-menu';

initializeLexical();
const engine = new URLSearchParams(location.search).get('engine') ?? 'native';
const users = () => [
  {
    id: 'macro|fixture@example.com',
    name: 'Example User',
    email: 'fixture@example.com',
  },
  {
    id: 'macro|other@example.com',
    name: 'Other Person',
    email: 'other@example.com',
  },
];
const entities = () => [];
function element(id: string) {
  const target = document.getElementById(id);
  if (!target) throw new Error('Missing mention integration element: ' + id);
  return target;
}
declare global {
  interface Window {
    nativeUserMenu?: {
      capture(): {
        engine: string;
        model: string;
        body: string;
        menus: string[];
      };
      close(): Promise<void>;
      queuedPick?(
        disposeDuringNotification: boolean
      ): Promise<{ beforeDrain: number; notifications: string[] }>;
    };
  }
}
function ready() {
  document.documentElement.dataset.ready = 'true';
}

function SourceFixture() {
  useHotKeyRoot();
  const menu = createMenuOperations();
  const wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'user-menu-integration',
    theme,
    isInteractable: () => true,
  });
  wrapper.plugins.richText().use(mentionsPlugin({ menu }));
  const root = element('body');
  root.contentEditable = 'true';
  wrapper.editor.setRootElement(root);
  const state = () => JSON.stringify(wrapper.editor.getEditorState().toJSON());
  const publish = () => {
    element('live-state').textContent = state();
  };
  onCleanup(wrapper.editor.registerUpdateListener(publish));
  wrapper.editor.update(
    () => $getRoot().append($createParagraphNode()).selectStart(),
    { discrete: true }
  );
  const save = () => {
    element('saved').textContent = state();
  };
  element('save').addEventListener('click', save);
  onCleanup(() => {
    element('save').removeEventListener('click', save);
    wrapper.cleanup();
    wrapper.editor.setRootElement(null);
  });
  window.nativeUserMenu = {
    capture: () => ({
      engine,
      model: state(),
      body: root.outerHTML,
      menus: [...document.querySelectorAll('.menu-surface')].map(
        (node) => node.outerHTML
      ),
    }),
    async close() {
      wrapper.cleanup();
      wrapper.editor.setRootElement(null);
    },
  };
  onMount(ready);
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <MentionsMenu
        editor={wrapper.editor}
        menu={menu}
        users={users}
        entities={entities}
        sources={['users']}
        includeGroups={false}
        includeContacts={false}
        useBlockBoundary={true}
        showOpenTabs
        sourceDocumentId="user-menu-fixture"
        disableMentionTracking
        portalScope="global"
      />
      <DecoratorRenderer editor={wrapper.editor} />
    </LexicalWrapperContext.Provider>
  );
}

function NativeFixture() {
  useHotKeyRoot();
  const context = createNativeUserMentionContext(theme);
  const root = element('body');
  const owner = getOwner() ?? undefined;
  const runtime = mountLocalSessionView(
    root,
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      createNativeUserMentionViews(context)
    ),
    {
      namespace: 'user-menu-integration',
      theme,
      editable: true,
      preset: 'rich',
      owner,
      onError(error) {
        throw error;
      },
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: nativeModule,
      create: (config, now, wall) =>
        nativeModule.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'user-menu-integration'
        ),
    }
  );
  const installed = installNativeMarkdownOverlays(runtime.view, {
    canEdit: () => true,
    mentions: {
      sourceDocumentId: 'user-menu-fixture',
      disableMentionTracking: true,
      users,
      entities,
      portalScope: 'global',
    },
  });
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [{ type: 'paragraph', version: 1, children: [] }],
      },
    })
  );
  const state = () => runtime.executor.session.serializedState();
  const publish = () => {
    element('live-state').textContent = state();
  };
  const release = runtime.view.onCommit(publish);
  publish();
  const save = () => {
    element('saved').textContent = state();
  };
  element('save').addEventListener('click', save);
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    installed.dispose();
    context.dispose();
    release();
    element('save').removeEventListener('click', save);
    closing = runtime.close();
    return closing;
  };
  onCleanup(() => fireAndForget(close(), 'native-user-menu-fixture-close'));
  window.nativeUserMenu = {
    async queuedPick(disposeDuringNotification) {
      const notifications: string[] = [];
      const host = createNativeUserMentionMenuHost(
        runtime.view,
        {
          sourceDocumentId: 'user-menu-fixture',
          disableMentionTracking: true,
          onUserMention() {
            notifications.push(state());
            if (disposeDuringNotification)
              fireAndForget(close(), 'native-user-menu-queued-close');
          },
        },
        () => !closing && runtime.view.isMounted
      );
      let beforeDrain = -1;
      let completion: Promise<void> | undefined;
      runtime.executor.run(() => {
        const user = users()[0];
        completion = host.select({
          kind: 'user',
          bucket: 'person',
          id: user.id,
          data: user,
          searchText: user.name,
          sortTimestamp: 0,
          timestamps: {},
        });
        beforeDrain = notifications.length;
        return 0;
      });
      await completion;
      return { beforeDrain, notifications };
    },
    capture: () => ({
      engine,
      model: state(),
      body: root.outerHTML,
      menus: [...document.querySelectorAll('.menu-surface')].map(
        (node) => node.outerHTML
      ),
    }),
    close,
  };
  const Overlays = installed.Overlays;
  if (!Overlays)
    throw new Error('Missing actual native user-menu installation');
  onMount(ready);
  return <Dynamic component={Overlays} />;
}
if (engine === 'native') await initialize();

render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessProvider>
                    {engine === 'native' ? (
                      <NativeFixture />
                    ) : (
                      <SourceFixture />
                    )}
                  </QuickAccessProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  element('menus')
);
