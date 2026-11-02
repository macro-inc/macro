import { URL_PARAMS as URL_PARAMS_CANVAS } from '@block-canvas/constants';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as URL_PARAMS_MD } from '@block-md/constants';
import { URL_PARAMS as URL_PARAMS_PDF } from '@block-pdf/constants';
import type { BlockAlias, BlockName } from '@core/block';
import { resolveBlockAlias } from '@core/constant/allBlocks';
import { lazyNamed } from '@core/util/lazyNamed';
import MessageIcon from '@icon/system/regular/chat-circle.svg';
import ThreadIcon from '@icon/system/regular/chats-circle.svg';
import HighlightIcon from '@icon/system/regular/highlighter-circle.svg';
import MapPinIcon from '@icon/system/regular/map-pin-simple.svg';
import { Card } from '@ui/components/Card';
import { Suspense } from 'solid-js';
import type { DocumentPreviewContentProps } from './DocumentPreviewContent';
import { DocumentPreviewSkeleton } from './DocumentPreviewSkeleton';

export type { DocumentPreviewContentProps } from './DocumentPreviewContent';

const PreviewBody = lazyNamed(
  () => import('./DocumentPreviewContent'),
  'DocumentPreviewContent'
);

/** Keep parsing, actions and rendering inside the visible preview's boundary. */
export function DocumentPreviewContent(props: DocumentPreviewContentProps) {
  return (
    <Suspense fallback={<DocumentPreviewSkeleton />}>
      <PreviewBody {...props} />
    </Suspense>
  );
}

/**
 * Returns the appropriate icon component based on the icon name
 * @param icon - Icon identifier string
 * @returns JSX element for the icon or undefined
 */
export const getMentionsIcon = (icon: string | undefined) => {
  if (!icon) return;

  const iconClasses =
    'relative top-[-0.125em] size-4 inline-flex items-center mx-1';

  switch (icon) {
    case 'highlight':
      return <HighlightIcon class={iconClasses} />;
    case 'map-pin':
      return <MapPinIcon class={iconClasses} />;
    case 'message':
      return <MessageIcon class={iconClasses} />;
    case 'thread':
      return <ThreadIcon class={iconClasses} />;
    case 'text':
      return <MapPinIcon class={iconClasses} />;
    default:
      return;
  }
};

/**
 * Determines additional context information for mentions based on block type
 */
export const mentionsAccessories = (
  blockName: BlockName | BlockAlias,
  params: Record<string, string>
): { note?: string; icon?: string } | undefined => {
  if (!params) return undefined;

  // PDF block handling
  if (blockName === 'pdf') {
    const id = params[URL_PARAMS_PDF.annotationId];
    if (id?.trim()) {
      return { note: `Annotation: ${id}` };
    }

    const pageIndex = Number(params[URL_PARAMS_PDF.pageNumber]);
    const y = parseInt(params[URL_PARAMS_PDF.yPos], 10);
    const width = Number(params[URL_PARAMS_PDF.width]);
    const height = Number(params[URL_PARAMS_PDF.height]);

    if (!isNaN(pageIndex) && pageIndex > 0) {
      if (
        !isNaN(y) &&
        !isNaN(width) &&
        !isNaN(height) &&
        width > 0 &&
        height > 0
      ) {
        return { note: `Page ${pageIndex}`, icon: 'highlight' };
      }
      return { note: `Page ${pageIndex}` };
    }
  }
  // Canvas block handling
  else if (blockName === 'canvas') {
    const x = 0 - Number(params[URL_PARAMS_CANVAS.x]);
    const y = Number(params[URL_PARAMS_CANVAS.y]);
    if (!isNaN(x) && !isNaN(y)) {
      return { note: `(x: ${x},  y: ${y})`, icon: 'map-pin' };
    }
    return;
  }
  // Channel block handling
  else if (blockName === 'channel') {
    const threadId = params[CHANNEL_PARAMS.thread];
    const messageId = params[CHANNEL_PARAMS.message];
    if (threadId) {
      return {
        icon: 'thread',
        note: 'Thread',
      };
    } else if (messageId) {
      return { icon: 'message', note: 'Message' };
    }
    return;
  }
  // Md block handling
  else if (resolveBlockAlias(blockName) === 'md') {
    const id = params[URL_PARAMS_MD.nodeId];
    const loc = params[URL_PARAMS_MD.location];
    if (id?.trim() || loc?.trim()) {
      return { icon: 'highlight', note: 'Snippet' };
    }

    const comment = params[URL_PARAMS_MD.commentId];
    if (comment?.trim()) {
      return { icon: 'message', note: 'Comment' };
    }
  }
};

/**
 * Floating hover-card preview for document references. This is the shell used by
 * {@link import('./ItemPreview').ItemPreview} hover cards: a fixed-width,
 * floating, rounded filled card with a semantic border and drop
 * shadow, plus mouse-enter/leave handling to keep the card alive while hovered.
 *
 * The reusable body lives in {@link DocumentPreviewContent}; this component only
 * adds the floating/highlight chrome around it.
 */
export function PopupPreview(
  props: DocumentPreviewContentProps & {
    mouseEnter: () => void;
    mouseLeave: () => void;
  }
) {
  return (
    <div
      class="select-none w-80 text-ink"
      onMouseEnter={props.mouseEnter}
      onMouseLeave={props.mouseLeave}
    >
      <Card
        variant="filled"
        depth={2}
        class="rounded-xl shadow-lg shadow-drop-shadow"
      >
        <Suspense fallback={<DocumentPreviewSkeleton />}>
          <DocumentPreviewContent
            delete={props.delete}
            convertToText={props.convertToText}
            collapseInfo={props.collapseInfo}
            documentInfo={props.documentInfo}
            previewInfo={props.previewInfo}
            snapshotInfo={props.snapshotInfo}
            useFallbackData={props.useFallbackData}
          />
        </Suspense>
      </Card>
    </div>
  );
}
