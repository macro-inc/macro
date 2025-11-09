import { mergeRegister } from '@lexical/utils';
import { HISTORY_MERGE_TAG } from '@lexical-core';
import {
  $getRoot,
  $getState,
  $setState,
  createState,
  type LexicalEditor,
  NODE_STATE_KEY,
  RootNode,
  type SerializedEditorState,
} from 'lexical';
import { MarkdownEditorErrors } from '../../constants';
import { MARKDOWN_VERSION_COUNTER, STAGING_TAG } from '../../version';

export type DocumentMetadata = {
  version: number;
  environmentTags?: string[];
};

const DEFAULT_METADATA: DocumentMetadata = {
  version: -1,
};

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

export function $setDocumentMetadata(
  metadata: Partial<DocumentMetadata>
): void {
  const root = $getRoot();
  const currentMetadata = $getState(root, documentMetadataState);
  const newMetadata = { ...currentMetadata, ...metadata };
  $setState(root, documentMetadataState, newMetadata);
}

export function $addEnvironmentTags(tags: string[]): void {
  const currentMetadata = $getDocumentMetadata();
  const existingTags = currentMetadata.environmentTags || [];
  const newTags = [...new Set([...existingTags, ...tags])];

  $setDocumentMetadata({
    environmentTags: newTags,
  });
}

export function $removeEnvironmentTags(tags: string[]): void {
  const currentMetadata = $getDocumentMetadata();
  const existingTags = currentMetadata.environmentTags || [];
  const filteredTags = existingTags.filter((tag) => !tags.includes(tag));

  $setDocumentMetadata({
    environmentTags: filteredTags.length > 0 ? filteredTags : undefined,
  });
}

export function $setDocumentVersion(version: number): void {
  $setDocumentMetadata({ version });
}

export function $hasEnvironmentTag(tag: string): boolean {
  const metadata = $getDocumentMetadata();
  return metadata.environmentTags?.includes(tag) ?? false;
}

/**
 * Get document version
 */
export function $getDocumentVersion(): number {
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
    $setDocumentMetadata(serialized);
  }
}

export function documentMetadataPlugin(props: {
  onVersionError?: (error: MarkdownEditorErrors) => void;
}) {
  return (editor: LexicalEditor) => {
    return mergeRegister(
      editor.registerUpdateListener(({ prevEditorState, mutatedNodes }) => {
        if (!mutatedNodes) return;
        const meta = prevEditorState.read(() => $getDocumentMetadata());
        queueMicrotask(() => {
          editor.update(
            () => {
              if (meta.version < MARKDOWN_VERSION_COUNTER) {
                $setDocumentVersion(MARKDOWN_VERSION_COUNTER);
              }
            },
            {
              tag: HISTORY_MERGE_TAG,
            }
          );
        });
      }),
      editor.registerNodeTransform(RootNode, () => {
        const meta = $getDocumentMetadata();
        if (meta.version > MARKDOWN_VERSION_COUNTER) {
          if (props.onVersionError) {
            if (meta.environmentTags?.includes(STAGING_TAG)) {
              props.onVersionError(
                MarkdownEditorErrors.STAGING_VERSION_MISMATCH_ERROR
              );
            } else {
              props.onVersionError(MarkdownEditorErrors.VERSION_MISMATCH_ERROR);
            }
          }
        }
      })
    );
  };
}
