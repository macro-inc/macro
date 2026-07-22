import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
import type { SplitContent, SplitContentType } from './layoutManager';

/** Default automatic-redistribution width for preview controllers. */
const DEFAULT_PREVIEW_CONTROLLER_WIDTH_PX = 440;

type PreviewControllerContentConfig = {
  type: SplitContentType;
  id: string;
  redistributionWidth?: number;
};

/** Non-list additions and exact-content overrides for preview controllers. */
const PREVIEW_CONTROLLER_CONTENT_CONFIG: readonly PreviewControllerContentConfig[] =
  [
    {
      type: 'component',
      id: LIST_VIEW_ID.mail,
      redistributionWidth: 880,
    },
  ];

function previewControllerConfig(content: SplitContent) {
  return PREVIEW_CONTROLLER_CONTENT_CONFIG.find(
    (candidate) =>
      candidate.type === content.type && candidate.id === content.id
  );
}

export function isPreviewControllerContent(content: SplitContent): boolean {
  return (
    (content.type === 'component' && isListViewID(content.id)) ||
    previewControllerConfig(content) !== undefined
  );
}

export function previewControllerWidthForContent(
  content: SplitContent
): number | undefined {
  if (!isPreviewControllerContent(content)) return undefined;
  const config = previewControllerConfig(content);
  return config?.redistributionWidth ?? DEFAULT_PREVIEW_CONTROLLER_WIDTH_PX;
}
