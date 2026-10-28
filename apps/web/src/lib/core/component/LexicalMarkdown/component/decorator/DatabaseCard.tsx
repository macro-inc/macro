import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import {
  $convertCardToMention,
  $isDocumentCardNode,
  type DocumentCardDecoratorProps,
} from '@macro-inc/lexical-core';
import { $getNodeByKey, SKIP_DOM_SELECTION_TAG } from 'lexical';
import {
  createSignal,
  lazy,
  onCleanup,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { LexicalInteractiveBoundary } from '../core/LexicalInteractiveBoundary';

const DocumentDatabase = lazy(async () => ({
  default: (await import('@app/features/block-database/document-database'))
    .DocumentDatabase,
}));

/** Database cards use their own metadata and editor, never document previews. */
export function DatabaseCard(props: DocumentCardDecoratorProps) {
  const enabled = useFeatureFlag(enableDatabases);
  const wrapper = useContext(LexicalWrapperContext);
  const [collapsed, setCollapsed] = createSignal(false);
  const [params, setParams] = createSignal(props.blockParams ?? {});
  let savedParams = props.blockParams;
  if (wrapper)
    onCleanup(
      wrapper.editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const node = $getNodeByKey(props.key);
          if (!$isDocumentCardNode(node)) return;
          const next = node.getBlockParams();
          if (next !== savedParams) {
            savedParams = next;
            setParams(next);
          }
        });
      })
    );
  const changeLocation = (params: Record<string, string>) => {
    setParams(params);
    if (!wrapper?.editor.isEditable() || !wrapper.isInteractable()) return;
    wrapper.editor.update(
      () => {
        const node = $getNodeByKey(props.key);
        if ($isDocumentCardNode(node)) node.setBlockParams(params);
      },
      { tag: SKIP_DOM_SELECTION_TAG }
    );
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
        <LexicalInteractiveBoundary>
          <DocumentDatabase
            databaseId={props.documentId}
            name={props.documentName}
            params={params()}
            collapsed={collapsed()}
            onToggle={toggle}
            onLocationChange={changeLocation}
          />
        </LexicalInteractiveBoundary>
      </Suspense>
    </Show>
  );
}
