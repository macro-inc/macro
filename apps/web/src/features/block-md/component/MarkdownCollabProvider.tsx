import { CollabProvider } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import type { PluginManager } from '@core/component/LexicalMarkdown/plugins';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { NodeIdMappings } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import type { Accessor, Setter } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { endDocumentSpan, resumeDocumentSpan } from '../observability';

// The sync tags and force-sync command live with the generic provider now;
// re-exported here so existing md-block imports keep working.
export {
  CODE_HIGHLIGHT_IDS_TAG,
  FORCE_SYNC_COMMAND,
  FROM_LORO_TAG,
} from '@core/component/LexicalMarkdown/collaboration/CollabProvider';

export type MarkdownCollabProviderProps = {
  editor: LexicalEditor;
  pluginManager: PluginManager;
  editorContainerRef: HTMLDivElement;
  highlighLayerRef: HTMLDivElement;
  mappings: NodeIdMappings;
  editorFocus: Accessor<boolean>;
  setEditorReady: Setter<boolean>;
  setEditorError: Setter<MarkdownEditorErrors | null>;
  loroManager: LoroManager;
};

/**
 * The md block's collaboration wiring: the generic {@link CollabProvider}
 * fed from block-scoped signals (sync source, permissions, error state) and
 * the block's document tracing spans, with the CollabStatus chrome.
 */
export function MarkdownCollabProvider(props: MarkdownCollabProviderProps) {
  const { documentSource, permissions, state } = useMarkdownDocument();
  const syncSource = () => {
    const source = documentSource();
    return source.type === 'sync' ? source.source : undefined;
  };

  return (
    <CollabProvider
      editor={props.editor}
      pluginManager={props.pluginManager}
      editorContainerRef={props.editorContainerRef}
      highlightLayerRef={props.highlighLayerRef}
      mappings={props.mappings}
      editorFocus={props.editorFocus}
      setEditorReady={props.setEditorReady}
      setEditorError={props.setEditorError}
      loroManager={props.loroManager}
      syncSource={syncSource}
      sourceReady={() => documentSource().type === 'sync'}
      canEdit={permissions.canEdit}
      canComment={permissions.canComment}
      editorError={state.editor.error}
      observability={{
        resumeSpan: resumeDocumentSpan,
        endSpan: endDocumentSpan,
      }}
    />
  );
}
