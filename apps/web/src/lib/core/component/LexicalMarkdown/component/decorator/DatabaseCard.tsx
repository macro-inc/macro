import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import {
  $convertCardToMention,
  $isDocumentCardNode,
  type DocumentCardDecoratorProps,
} from '@macro-inc/lexical-core';
import { $getNodeByKey, stopLexicalPropagation } from 'lexical';
import { createSignal, lazy, Show, Suspense, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

const DocumentDatabase = lazy(async () => ({
  default: (await import('@app/features/block-database/document-database'))
    .DocumentDatabase,
}));

/** Database cards use their own metadata and editor, never document previews. */
export function DatabaseCard(props: DocumentCardDecoratorProps) {
  const enabled = useFeatureFlag(enableDatabases);
  const wrapper = useContext(LexicalWrapperContext);
  const [collapsed, setCollapsed] = createSignal(false);
  const changeLocation = (params: Record<string, string>) => {
    if (!wrapper?.editor.isEditable() || !wrapper.isInteractable()) return;
    wrapper.editor.update(() => {
      const node = $getNodeByKey(props.key);
      if ($isDocumentCardNode(node)) node.setBlockParams(params);
    });
  };
  const toggle = () => {
    if (!wrapper?.editor.isEditable() || !wrapper.isInteractable()) {
      setCollapsed(!collapsed());
      return;
    }
    wrapper.editor.update(() => {
      const node = $getNodeByKey(props.key);
      if ($isDocumentCardNode(node)) $convertCardToMention(node).selectEnd();
    });
  };
  const placeholder = () => (
    <div class="my-2 rounded-lg border border-edge-muted px-3 py-2 text-sm text-ink-muted">
      {props.documentName || 'Database'}
    </div>
  );
  return (
    <Show
      when={enabled().enabled && !wrapper?.skipPreviewFetch}
      fallback={placeholder()}
    >
      <Suspense fallback={placeholder()}>
        <div
          // Keep grid events out of outer Lexical while allowing Solid's
          // delegated handlers and native browser editing to receive them.
          on:keydown={stopLexicalPropagation}
          on:beforeinput={stopLexicalPropagation}
          on:input={stopLexicalPropagation}
          on:compositionstart={stopLexicalPropagation}
          on:compositionend={stopLexicalPropagation}
          on:paste={stopLexicalPropagation}
          on:copy={stopLexicalPropagation}
          on:cut={stopLexicalPropagation}
          on:drop={stopLexicalPropagation}
          on:dragstart={stopLexicalPropagation}
          on:click={stopLexicalPropagation}
        >
          <DocumentDatabase
            databaseId={props.documentId}
            name={props.documentName}
            params={props.blockParams}
            collapsed={collapsed()}
            onToggle={toggle}
            onLocationChange={changeLocation}
          />
        </div>
      </Suspense>
    </Show>
  );
}
