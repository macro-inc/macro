import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { UserMentionNode } from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { $createParagraphNode, $getRoot } from 'lexical';
import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { UserMention } from '../../component/decorator/UserMention';
import { MentionsMenu } from '../../component/menu/MentionsMenu';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { mentionsPlugin } from '../../plugins/mentions/mentionsPlugin';
import { createMenuOperations } from '../../shared/inlineMenu';

function element(id: string) {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Missing Source mention fixture element ${id}`);
  return target;
}

setDecorator(UserMentionNode, UserMention);

function Fixture() {
  useHotKeyRoot();
  const menu = createMenuOperations();
  const wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'source-mention-overlay-fixture',
    isInteractable: () => true,
  });
  wrapper.plugins.richText().use(mentionsPlugin({ menu }));
  const root = element('body');
  root.contentEditable = 'true';
  wrapper.editor.setRootElement(root);
  const publish = () => {
    element('live-state').textContent = JSON.stringify(
      wrapper.editor.getEditorState().toJSON()
    );
  };
  onCleanup(wrapper.editor.registerUpdateListener(publish));
  wrapper.editor.update(
    () => $getRoot().append($createParagraphNode()).selectStart(),
    { discrete: true }
  );
  const save = () => {
    element('saved').textContent = JSON.stringify(
      wrapper.editor.getEditorState().toJSON()
    );
  };
  element('save').addEventListener('click', save);
  onCleanup(() => {
    element('save').removeEventListener('click', save);
    wrapper.cleanup();
    wrapper.editor.setRootElement(null);
  });
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <MentionsMenu
        editor={wrapper.editor}
        menu={menu}
        users={() => [
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
        ]}
        entities={() => []}
        sources={['users']}
        showOpenTabs={false}
        disableMentionTracking
        portalScope="global"
      />
      <DecoratorRenderer editor={wrapper.editor} />
    </LexicalWrapperContext.Provider>
  );
}

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
                    <Fixture />
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
document.documentElement.dataset.ready = 'true';
