import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatingFormatMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingFormatMenu';
import { FloatingLinkMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { restoreFocusPlugin } from '@core/component/LexicalMarkdown/plugins/restore-focus';
import { selectionDataPlugin } from '@core/component/LexicalMarkdown/plugins/selection-data/selectionDataPlugin';
import { listToTablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/listToTablePlugin';
import { tablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/tablePlugin';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { $createLinkNode } from '@lexical/link';
import { $createHeadingNode, registerRichText } from '@lexical/rich-text';
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableRowNode,
} from '@lexical/table';
import { Toolbar } from '@ui';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
} from 'lexical';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { MarkdownDocumentProvider } from '../../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../../context/markdown-document-state';
import { FormatTools } from '../../FormatTools';
import '@app/index.css';
import { desktopBodyFormatPopup } from '../../../views/body-format-popup';

if (import.meta.env.VITE_ENABLE_RUST_EDITOR_MODEL !== 'false')
  throw new Error(
    'Source formatting baseline requires the explicit OFF profile'
  );

function FormattingFixture() {
  const state = createMarkdownDocumentState();
  const [canEdit, setCanEdit] = createSignal(true);
  const wrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'formatting-component',
    withIds: true,
    isInteractable: canEdit,
  });
  const editor = wrapper.editor;
  const [saved, setSaved] = createSignal('');
  const [live, setLive] = createSignal('');
  let body: HTMLDivElement | undefined;
  const floating = new URLSearchParams(location.search).has('floating');
  wrapper.plugins.use(selectionDataPlugin(wrapper));
  wrapper.plugins.use(
    tablePlugin({
      hasCellMerge: true,
      hasCellBackgroundColor: true,
      hasHorizontalScroll: true,
      hasTabHandler: true,
    })
  );
  wrapper.plugins.use(listToTablePlugin());
  wrapper.plugins.use(restoreFocusPlugin());
  state.editor.setMd({
    editor,
    plugins: wrapper.plugins,
    mapping: wrapper.mapping,
    selection: wrapper.selection,
  });
  const cleanupRichText = registerRichText(editor);
  const cleanupHistory = registerHistory(
    editor,
    createEmptyHistoryState(),
    400
  );
  const [selectionFormat, setSelectionFormat] = createSignal(0);
  const cleanupUpdate = editor.registerUpdateListener(({ editorState }) => {
    setLive(JSON.stringify(editorState.toJSON()));
    editorState.read(() => {
      const selection = $getSelection();
      setSelectionFormat($isRangeSelection(selection) ? selection.format : 0);
    });
  });
  onMount(() => {
    if (!body) throw new Error('Missing actual Source root');
    editor.setRootElement(body);
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Select this phrase'))
        );
      },
      { discrete: true }
    );
    document.documentElement.dataset.ready = 'true';
  });
  onCleanup(() => {
    cleanupUpdate();
    cleanupHistory();
    cleanupRichText();
    wrapper.cleanup();
    editor.setRootElement(null);
  });
  const loadTable = () =>
    editor.update(
      () => {
        const table = $createTableNodeWithDimensions(3, 3, false);
        let index = 0;
        for (const row of table.getChildren()) {
          if (!$isTableRowNode(row))
            throw new Error('Expected actual TableRowNode');
          for (const cell of row.getChildren()) {
            if (!$isTableCellNode(cell))
              throw new Error('Expected actual TableCellNode');
            index++;
            cell
              .clear()
              .append(
                $createParagraphNode().append($createTextNode(`Cell ${index}`))
              );
          }
        }
        $getRoot().clear().append(table);
      },
      { discrete: true }
    );
  const loadFormatting = () =>
    editor.update(
      () => {
        const link = $createLinkNode('https://example.com').append(
          $createTextNode('linked')
        );
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode('Plain')),
            $createHeadingNode('h4').append($createTextNode('Four')),
            $createParagraphNode().append(link),
            $createHeadingNode('h6').append($createTextNode('Six'))
          );
      },
      { discrete: true }
    );
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <MarkdownDocumentProvider
          context={{
            documentId: () => 'formatting-component',
            kind: () => 'document',
            // Local component initialization, without claiming a server source.
            documentSource: () => ({ type: 'loading' }),
            permissions: {
              canEdit,
              canComment: () => false,
              isOwner: () => true,
            },
            persistedName: () => undefined,
            fallbackName: () => undefined,
            bodyFormatPopup: () => desktopBodyFormatPopup,
            state,
            element: () => body,
          }}
        >
          <LexicalWrapperContext.Provider value={wrapper}>
            <FloatingMenuGroup>
              <main class="mx-auto max-w-4xl p-8">
                <Show when={!floating}>
                  <Toolbar aria-label="Document formatting">
                    <FormatTools withinPopup />
                  </Toolbar>
                </Show>
                <div
                  id="body"
                  ref={body}
                  role="textbox"
                  aria-label="Body"
                  contentEditable={canEdit()}
                  class="md border border-edge p-4 my-8"
                />
                <button type="button" onClick={loadFormatting}>
                  Load formatting facts
                </button>
                <output id="selection-facts" hidden>
                  {JSON.stringify({
                    format: selectionFormat(),
                    hasLinks: wrapper.selection?.hasLinks,
                    elementsInRange: [
                      ...(wrapper.selection?.elementsInRange ?? []),
                    ],
                  })}
                </output>
                <button type="button" onClick={loadTable}>
                  Load table
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCanEdit(false);
                    editor.setEditable(false);
                  }}
                >
                  Read only
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSaved(JSON.stringify(editor.getEditorState().toJSON()))
                  }
                >
                  Save state
                </button>
                <output id="live-state" hidden>
                  {live()}
                </output>
                <output id="saved">{saved()}</output>
              </main>
              <FloatingLinkMenu autoLinkMatchMode="common-tlds" />
              <Show when={floating}>
                <FloatingFormatMenu />
              </Show>
            </FloatingMenuGroup>
          </LexicalWrapperContext.Provider>
        </MarkdownDocumentProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

// ?caret: the C-TOUCH-CARET-MODE-01 Source caret page, in its own module.
if (new URLSearchParams(location.search).has('caret')) {
  await import('./caret-source');
} else {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing formatting component mount');
  render(FormattingFixture, app);
}
