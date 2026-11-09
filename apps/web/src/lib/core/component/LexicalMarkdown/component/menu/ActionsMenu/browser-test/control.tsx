import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { $createParagraphNode, $getRoot } from 'lexical';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../../../context/LexicalWrapperContext';
import { ACTIONS } from '../../../../plugins/actions/actions';
import { actionsPlugin } from '../../../../plugins/actions/actionsPlugin';
import { NODE_TRANSFORM } from '../../../../plugins/node-transform';
import { createMenuOperations } from '../../../../shared/inlineMenu';
import { ActionMenu } from '../../ActionsMenu';

function Fixture() {
  const wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'slash-source-control',
    isInteractable: () => true,
  });
  const { editor } = wrapper;
  const menu = createMenuOperations();
  wrapper.plugins.richText().list().use(actionsPlugin({ menu }));
  const [state, setState] = createSignal('');
  let root!: HTMLDivElement;
  const heading = ACTIONS.find((action) => action.id === 'heading1');
  if (!heading) throw new Error('Missing source heading action');
  const override = {
    ...heading,
    name: 'Custom quote',
    keywords: ['custom'],
    action: () => {
      editor.dispatchCommand(NODE_TRANSFORM, 'quote');
    },
  };
  function reset() {
    editor.update(() => {
      const paragraph = $createParagraphNode();
      $getRoot().clear().append(paragraph);
      paragraph.selectEnd();
    });
    editor.focus();
  }
  onMount(() => {
    editor.setRootElement(root);
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      setState(JSON.stringify(editorState.toJSON()));
    });
    onCleanup(() => {
      unregister();
      editor.setRootElement(null);
    });
    reset();
  });
  onCleanup(wrapper.cleanup);
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <main class="p-4 bg-page text-ink space-y-4">
        <button type="button" onClick={reset}>
          Reset editor
        </button>
        <div
          ref={root}
          role="textbox"
          aria-label="Source editor"
          aria-multiline="true"
          contentEditable
          class="border p-2 min-h-24"
        />
        <ActionMenu
          editor={editor}
          menu={menu}
          additionalActions={[override]}
        />
        <pre data-testid="state">{state()}</pre>
      </main>
    </LexicalWrapperContext.Provider>
  );
}
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <Fixture />
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
