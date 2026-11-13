import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import type { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { MarkdownSplitHeader } from './MarkdownSplitHeader';

/** Adapts the legacy Block's metadata and access to the document header. */
export function TopBar(props: { collaborationStatus?: SyncSourceStatus }) {
  const permissions = useGetPermissions();
  const document = () => {
    const metadata = blockMetadataSignal();
    if (!metadata) return;
    return {
      documentId: metadata.documentId,
      ownerId: metadata.owner,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };
  };

  return (
    <MarkdownSplitHeader
      document={document()}
      collaborationStatus={props.collaborationStatus}
      permissions={permissions()}
      actions={
        // Hidden on mobile/tablet: no floating-island treatment for live avatars yet.
        <div class="-order-1 touch:hidden">
          <BlockLiveIndicators />
        </div>
      }
    />
  );
}
