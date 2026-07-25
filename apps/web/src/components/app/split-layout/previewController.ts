import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
import type { SplitContent, SplitContentType } from './layoutManager';

type PreviewControllerWidth = {
  preferredPx: number;
  /** Optional viewport-relative ceiling, where 0.75 corresponds to 75vw. */
  maxViewportFraction?: number;
};

/** Default automatic-redistribution width for preview controllers. */
const DEFAULT_PREVIEW_CONTROLLER_WIDTH: PreviewControllerWidth = {
  preferredPx: 440,
};

type PreviewControllerContentConfig = {
  type: SplitContentType;
  /** Omit to match every block with this content type. */
  id?: string;
  redistributionWidth?: PreviewControllerWidth;
};

/** Non-list additions and exact-content overrides for preview controllers. */
const PREVIEW_CONTROLLER_CONTENT_CONFIG: readonly PreviewControllerContentConfig[] =
  [
    {
      type: 'project',
    },
    {
      type: 'component',
      id: LIST_VIEW_ID.mail,
      redistributionWidth: { preferredPx: 1050, maxViewportFraction: 0.6 },
    },
    {
      type: 'component',
      id: LIST_VIEW_ID.companies,
      redistributionWidth: {
        preferredPx: 880,
        maxViewportFraction: 0.7,
      },
    },
  ];

function previewControllerConfig(content: SplitContent) {
  return PREVIEW_CONTROLLER_CONTENT_CONFIG.find(
    (candidate) =>
      candidate.type === content.type &&
      (candidate.id === undefined || candidate.id === content.id)
  );
}

export function isPreviewControllerContent(content: SplitContent): boolean {
  return (
    (content.type === 'component' && isListViewID(content.id)) ||
    previewControllerConfig(content) !== undefined
  );
}

export function previewControllerWidthForContent(
  content: SplitContent,
  viewportWidth?: number
): number | undefined {
  if (!isPreviewControllerContent(content)) return undefined;
  const config = previewControllerConfig(content);
  const width = config?.redistributionWidth ?? DEFAULT_PREVIEW_CONTROLLER_WIDTH;
  const viewportMax =
    width.maxViewportFraction !== undefined &&
    viewportWidth !== undefined &&
    viewportWidth > 0
      ? viewportWidth * width.maxViewportFraction
      : Infinity;
  return Math.min(width.preferredPx, viewportMax);
}
