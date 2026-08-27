import { markdownBlockErrorSignal } from '@block-md/signal/error';
import { CollabProvider } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import type { PluginManager } from '@core/component/LexicalMarkdown/plugins';
import { blockSourceSignal, blockSyncSourceSignal } from '@core/signal/load';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import { isSourceSyncService } from '@core/util/source';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { NodeIdMappings } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import type { Accessor, Setter } from 'solid-js';
import { endDocumentSpan, resumeDocumentSpan } from '../observability';
import { CollabStatus } from './CollabStatus';

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
  const docSource = blockSourceSignal.get;
  const syncSource = blockSyncSourceSignal.get;
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const [editorError] = markdownBlockErrorSignal;

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
      sourceReady={() => {
        const source = docSource();
        return !!source && isSourceSyncService(source);
      }}
      canEdit={canEdit}
      canComment={canComment}
      editorError={editorError}
      observability={{
        resumeSpan: resumeDocumentSpan,
        endSpan: endDocumentSpan,
      }}
      statusChrome={<CollabStatus />}
    />
  );
}
