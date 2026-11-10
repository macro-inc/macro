import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { $dfs } from '@lexical/utils';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  $createUserMentionNode,
  UserMentionNode,
} from '@macro-inc/lexical-core';
import { $setId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
  $setSelection,
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
import { mentionsPlugin } from '../../plugins/mentions/mentionsPlugin';
import { selectionDataPlugin } from '../../plugins/selection-data/selectionDataPlugin';
import { theme } from '../../theme';
import { createLexicalDecoratorHost } from '../lexical';
import { createNativeUserMentionContext } from '../native-user-mention-host';
import { createNativeUserMentionViews } from '../native-user-mention-views';
import initialize, { EditorSession } from './wasm/document_session_wasm.js';

initializeLexical();
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|viewer@example.com',
  email: 'viewer@example.com',
  permissions: [],
});
const params = new URLSearchParams(location.search);
const identity = params.get('identity') ?? 'ordinary';
const native = params.get('engine') === 'native';
interface Capture {
  model: string;
  dom: string;
}
declare global {
  interface Window {
    userMentionInput?: string;
    userMentionFixture?: {
      capture(): Capture;
      select(): void;
      clear(): void;
      update(name: string): void;
      editable(value: boolean): void;
      authorization?(edit: boolean): void;
      retireHost?(): void;
      closeView?(): Promise<{
        samePromise: boolean;
        pointerZero: boolean;
        componentRemoved: boolean;
      }>;
    };
  }
}
function seed() {
  const root = $getRoot();
  $setId(root, 'user-mention-root');
  root.append(
    $createParagraphNode().append(
      $createUserMentionNode({
        userId: 'macro|fixture@example.com',
        email: 'fixture@example.com',
        displayName: 'Fixture Mention',
      })
    )
  );
  for (const [index, { node }] of $dfs().slice(1).entries())
    $setId(node, `user-mention-${index}`);
}
function SourceFixture() {
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'user-mention-fixture',
    withIds: true,
    theme,
    isInteractable: () => true,
  });
  wrapper.plugins
    .richText()
    .use(selectionDataPlugin(wrapper))
    .use(documentMetadataPlugin({}))
    .use(mentionsPlugin({ disableMentionTracking: true }));
  const host = createLexicalDecoratorHost(wrapper);
  let root: HTMLDivElement | undefined;
  onMount(() => {
    if (!root) throw new Error('Missing Source root');
    wrapper.editor.setRootElement(root);
    if (window.userMentionInput) {
      wrapper.editor.read(() => $getDocumentMetadata());
      wrapper.editor.setEditorState(
        wrapper.editor.parseEditorState(window.userMentionInput)
      );
    } else {
      wrapper.editor.update(seed, { discrete: true });
      if (identity !== 'ordinary') {
        const data = wrapper.editor.getEditorState().toJSON();
        for (const paragraph of data.root.children) {
          if (!('children' in paragraph) || !Array.isArray(paragraph.children))
            continue;
          for (const node of paragraph.children) {
            if (
              typeof node !== 'object' ||
              node === null ||
              node.type !== 'user-mention'
            )
              continue;
            const field =
              identity === 'null-uuid'
                ? 'mentionUuid'
                : identity.endsWith('-email')
                  ? 'email'
                  : 'userId';
            if (identity.startsWith('missing'))
              Reflect.deleteProperty(node, field);
            else Reflect.set(node, field, null);
          }
        }
        wrapper.editor.setEditorState(
          wrapper.editor.parseEditorState(JSON.stringify(data))
        );
      }
    }
    const element = root;
    const userId = () =>
      identity === 'missing'
        ? 'undefined'
        : identity === 'null'
          ? 'null'
          : 'macro|fixture@example.com';
    window.userMentionFixture = {
      capture: () => ({
        model: JSON.stringify(wrapper.editor.getEditorState().toJSON()),
        dom: element.innerHTML,
      }),
      select() {
        wrapper.editor.update(
          () => {
            const node = $nodesOfType(UserMentionNode)[0];
            if (!node) throw new Error('Missing Source mention');
            const selection = $createNodeSelection();
            selection.add(node.getKey());
            $setSelection(selection);
          },
          { discrete: true }
        );
      },
      clear() {
        wrapper.editor.update(() => $setSelection(null), { discrete: true });
      },
      update: (name) => host.updateUserDisplayName(userId(), name),
      editable: (value) => {
        wrapper.editor.setEditable(value);
        element.contentEditable = String(value);
      },
    };
  });
  onCleanup(() => {
    delete window.userMentionFixture;
    wrapper.editor.setRootElement(null);
    wrapper.cleanup();
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <FloatingMenuGroup>
        <div
          ref={root}
          role="textbox"
          aria-label="User mention fixture"
          contentEditable
          class="md w-[640px] min-h-40 p-4 outline-none"
        />
        <DecoratorRenderer editor={wrapper.editor} />
      </FloatingMenuGroup>
    </LexicalWrapperContext.Provider>
  );
}
function NativeFixture() {
  const owner = getOwner() ?? undefined;
  const context = createNativeUserMentionContext(theme);
  let root: HTMLDivElement | undefined;
  let runtime: ReturnType<typeof mountLocalSessionView> | undefined;
  let closed = false;
  async function mount() {
    await initialize();
    if (closed) return;
    if (!root || !window.userMentionInput)
      throw new Error('Native requires the same actual Source import');
    const registry = registerMacroElementViews(createBuiltinRegistry());
    registerMacroDecoratorViews(
      registry,
      createNativeUserMentionViews(context)
    );
    runtime = mountLocalSessionView(
      root,
      registry,
      {
        namespace: 'user-mention-fixture',
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
        create: (config, now, wall) =>
          EditorSession.createMacroWithNamespace(
            ABI_MAJOR,
            config,
            now,
            wall,
            'user-mention-fixture'
          ),
      }
    );
    const mounted = runtime;
    mounted.port.setState(window.userMentionInput);
    const element = root;
    window.userMentionFixture = {
      capture: () => ({
        model: mounted.executor.session.serializedState(),
        dom: element.innerHTML,
      }),
      select() {
        const node = [...mounted.view.mirror.values()].find(
          (node) => node.type === 'user-mention'
        );
        if (!node) throw new Error('Missing native mention');
        mounted.port.selectionFromView({ kind: 'node', keys: [node.key] });
      },
      clear: () => mounted.port.selectionFromView({ kind: 'none' }),
      update: (name) =>
        context.host.updateUserDisplayName(
          identity === 'missing'
            ? 'undefined'
            : identity === 'null'
              ? 'null'
              : 'macro|fixture@example.com',
          name
        ),
      editable: (value) => mounted.view.setEditable(value),
      authorization(edit) {
        mounted.executor.run(() =>
          mounted.executor.session.authorization(
            true,
            edit,
            edit,
            mounted.executor.now(),
            Date.now()
          )
        );
      },
      retireHost: () => context.dispose(),
      async closeView() {
        context.dispose();
        const first = mounted.close();
        const again = mounted.close();
        await first;
        return {
          samePromise: first === again,
          pointerZero: Reflect.get(mounted.executor.session, '__wbg_ptr') === 0,
          componentRemoved:
            element.querySelector('[data-user-mention]') === null,
        };
      },
    };
  }
  onMount(() => fireAndForget(mount(), 'user-mention-fixture'));
  onCleanup(() => {
    closed = true;
    context.dispose();
    delete window.userMentionFixture;
    if (runtime) fireAndForget(runtime.close(), 'user-mention-fixture-close');
  });
  return (
    <FloatingMenuGroup>
      <div
        ref={root}
        role="textbox"
        aria-label="User mention fixture"
        class="md w-[640px] min-h-40 p-4 outline-none"
      />
    </FloatingMenuGroup>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <EmailLinksContextProvider>
              <MobileSettingsProvider>
                <MemoryRouter>
                  <Route
                    path="*"
                    component={native ? NativeFixture : SourceFixture}
                  />
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
