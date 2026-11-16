import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { registerRichText } from '@lexical/rich-text';
import { $createParagraphNode, $getRoot } from 'lexical';
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import { ActionMenu } from '../../component/menu/ActionsMenu';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { actionsPlugin } from '../../plugins/actions/actionsPlugin';
import { createMenuOperations } from '../../shared/inlineMenu';
import { registerDatabaseFixtureComponents } from './fixture-views';
import { complete } from './service';

function element(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing ${id}`);
  return node;
}
const close = createRoot((dispose) => {
  registerDatabaseFixtureComponents();
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'source-database-action-fixture',
    withIds: true,
    isInteractable: () => true,
  });
  const editor = wrapper.editor;
  element('body').contentEditable = 'true';
  editor.setRootElement(element('body'));
  const rich = registerRichText(editor);
  const menu = createMenuOperations();
  wrapper.plugins.use(actionsPlugin({ menu }));
  const release = editor.registerUpdateListener(({ editorState }) => {
    element('model').textContent = JSON.stringify(editorState.toJSON());
  });
  const disposeUI = render(
    () => (
      <AnalyticsContextProvider>
        <PosthogProvider>
          <LexicalWrapperContext.Provider value={wrapper}>
            <ToastRegion />
            <ActionMenu
              editor={editor}
              menu={menu}
              anchor={element('body')}
              portalScope="global"
              actionContext={{ disableMentionTracking: true }}
            />
            <DecoratorRenderer editor={editor} />
          </LexicalWrapperContext.Provider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    ),
    element('menus')
  );
  editor.update(() => $getRoot().append($createParagraphNode()), {
    discrete: true,
  });
  element('complete').addEventListener('click', complete);
  element('save').addEventListener('click', () => {
    element('model').textContent = JSON.stringify(
      editor.getEditorState().toJSON()
    );
  });
  return () => {
    release();
    rich();
    wrapper.cleanup();
    editor.setRootElement(null);
    disposeUI();
    dispose();
  };
});
window.addEventListener('pagehide', close, { once: true });
document.documentElement.dataset.ready = 'true';
