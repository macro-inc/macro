import { COLLABORATION_TAG, LOCAL_STATUS_TAG } from '@macro-inc/lexical-core';
import {
  $addUpdateTag,
  $getRoot,
  $getState,
  $hasUpdateTag,
  $setState,
  createState,
  type LexicalEditor,
  NODE_STATE_KEY,
  RootNode,
  type SerializedEditorState,
} from 'lexical';
import { MarkdownEditorErrors } from '../../constants';
import { MARKDOWN_VERSION_COUNTER } from '../../version';

type DocumentMetadata = {
  version: number;
  environmentTags?: string[];
};

const DEFAULT_METADATA: DocumentMetadata = {
  version: -1,
};

/**
 * Marks the updates that load a stored document into the editor. Add it only
 * to an update that changes the document: Lexical carries the tags of an
 * update that changes nothing over to the next update, so the next edit would
 * skip its stamp.
 */
export const LOAD_STATE_TAG = 'load-state';

// Updates that load or receive the stored state, or record per-peer status for
// it. None of them is written to the shared document on its own, so a stamp
// set in one would be written later as this viewer's edit, moving the
// document's Updated time when it was only opened.
const NOT_LOCAL_EDIT_TAGS = [
  LOAD_STATE_TAG,
  COLLABORATION_TAG,
  LOCAL_STATUS_TAG,
];

const documentMetadataState = createState('documentMetadata', {
  parse: (value: unknown): DocumentMetadata => {
    if (value === undefined || value === null) {
      return DEFAULT_METADATA;
    }
    if (typeof value === 'object') {
      const obj = value as any;
      const result = {
        version:
          typeof obj.version === 'number'
            ? obj.version
            : DEFAULT_METADATA.version,
        environmentTags: Array.isArray(obj.environmentTags)
          ? obj.environmentTags.filter(
              (tag: unknown) => typeof tag === 'string'
            )
          : null,
      };
      return result;
    }
    return DEFAULT_METADATA;
  },
});

export function $getDocumentMetadata(): DocumentMetadata {
  const root = $getRoot();
  return $getState(root, documentMetadataState);
}

function $setDocumentMetadata(metadata: Partial<DocumentMetadata>): void {
  const root = $getRoot();
  const currentMetadata = $getState(root, documentMetadataState);
  const newMetadata = { ...currentMetadata, ...metadata };
  $setState(root, documentMetadataState, newMetadata);
}

function _$addEnvironmentTags(tags: string[]): void {
  const currentMetadata = $getDocumentMetadata();
  const existingTags = currentMetadata.environmentTags || [];
  const newTags = [...new Set([...existingTags, ...tags])];

  $setDocumentMetadata({
    environmentTags: newTags,
  });
}

function _$removeEnvironmentTags(tags: string[]): void {
  const currentMetadata = $getDocumentMetadata();
  const existingTags = currentMetadata.environmentTags || [];
  const filteredTags = existingTags.filter((tag) => !tags.includes(tag));

  $setDocumentMetadata({
    environmentTags: filteredTags.length > 0 ? filteredTags : undefined,
  });
}

function $setDocumentVersion(version: number): void {
  $setDocumentMetadata({ version });
}

function _$hasEnvironmentTag(tag: string): boolean {
  const metadata = $getDocumentMetadata();
  return metadata.environmentTags?.includes(tag) ?? false;
}

/**
 * Get document version
 */
function _$getDocumentVersion(): number {
  const metadata = $getDocumentMetadata();
  return metadata.version;
}

export function $applyDocumentMetadataFromSerialized(
  state: SerializedEditorState
): void {
  const serialized = state.root?.[NODE_STATE_KEY]?.documentMetadata;
  if (
    serialized &&
    typeof serialized === 'object' &&
    Object.getOwnPropertyNames(serialized).length > 0
  ) {
    $addUpdateTag(LOAD_STATE_TAG);
    $setDocumentMetadata(serialized);
  }
}

export function documentMetadataPlugin(props: {
  onVersionError?: (error: MarkdownEditorErrors) => void;
}) {
  // Lexical runs the root's transform last in every update that changes the
  // document, so the stamp is part of the same update, and the same write, as
  // the edit that needs it.
  return (editor: LexicalEditor) =>
    editor.registerNodeTransform(RootNode, () => {
      const meta = $getDocumentMetadata();
      if (meta.version > MARKDOWN_VERSION_COUNTER) {
        props.onVersionError?.(MarkdownEditorErrors.VERSION_MISMATCH_ERROR);
        return;
      }
      if (meta.version === MARKDOWN_VERSION_COUNTER) return;
      if (NOT_LOCAL_EDIT_TAGS.some((tag) => $hasUpdateTag(tag))) return;
      $setDocumentVersion(MARKDOWN_VERSION_COUNTER);
    });
}
