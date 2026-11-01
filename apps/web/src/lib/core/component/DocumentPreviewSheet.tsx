import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Suspense } from 'solid-js';
import {
  DocumentPreviewContent,
  type DocumentPreviewContentProps,
} from './DocumentPreview';
import { DocumentPreviewSkeleton } from './DocumentPreviewSkeleton';

/**
 * The preview card as a bottom sheet. `HoverCard` renders nothing on touch
 * devices, so a mention whose tap shows its preview instead of opening it
 * presents the same card here.
 */
export function DocumentPreviewSheet(
  props: DocumentPreviewContentProps & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }
) {
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      closeOnOutsidePointerStrategy="pointerdown"
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus
      noOutsidePointerEvents={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Preview">
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody class="px-3 text-ink">
            <Suspense fallback={<DocumentPreviewSkeleton />}>
              <DocumentPreviewContent
                delete={props.delete}
                convertToText={props.convertToText}
                collapseInfo={props.collapseInfo}
                documentInfo={props.documentInfo}
                previewInfo={props.previewInfo}
                snapshotInfo={props.snapshotInfo}
                useFallbackData={props.useFallbackData}
                onOpened={() => props.onOpenChange(false)}
              />
            </Suspense>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
