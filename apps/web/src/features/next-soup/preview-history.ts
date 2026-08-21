import type { SplitContent } from '@components/app/split-layout/layoutManager';

const PREVIEW_SOURCE_ENTITY_ID_STATE_KEY = 'soup.previewSourceEntityId';

/** Stamp the controller row identity onto a preview viewer history entry. */
export function withPreviewSourceEntityId(
  content: SplitContent,
  entityId: string
): SplitContent {
  return {
    ...content,
    state: {
      ...content.state,
      [PREVIEW_SOURCE_ENTITY_ID_STATE_KEY]: entityId,
    },
  };
}

/** The controller row that created this preview viewer history entry. */
export function previewSourceEntityId(
  content: SplitContent
): string | undefined {
  const value = content.state?.[PREVIEW_SOURCE_ENTITY_ID_STATE_KEY];
  return typeof value === 'string' ? value : undefined;
}
