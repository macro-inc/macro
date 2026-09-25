import type { BlockAlias, BlockName } from '@core/block';
import { queryReadyGate } from '@queries/gate';
import {
  useDocumentAccessLevelQuery,
  useDocumentMetadataQuery,
} from '@queries/storage/document-metadata';
import {
  type DialogHandle,
  type ManagedDialogInput,
  openDialog,
  useImperativeDialog,
} from '@ui';
import { type Accessor, type ComponentProps, Suspense } from 'solid-js';
import { getPermissions } from '../SharePermissions';
import { ShareModal } from './ShareButton';

type ShareModalProps = ComponentProps<typeof ShareModal>;

/** Props callers provide when opening the share modal. */
export type ShareModalInput = ManagedDialogInput<ShareModalProps>;

function SuspendedShareModal(props: ShareModalProps) {
  return (
    <Suspense>
      <ShareModal {...props} />
    </Suspense>
  );
}

/** Opens the share modal outside of any component, e.g. from a list action. */
export function openShareModal(props: ShareModalInput): DialogHandle {
  return openDialog(SuspendedShareModal, props);
}

/**
 * Returns an opener for a share modal owned by the calling component. The
 * modal follows `props` while open and closes when the component unmounts.
 */
export function useShareModal(
  props: Accessor<ShareModalInput | undefined>
): () => void {
  const dialog = useImperativeDialog(SuspendedShareModal);
  return () => {
    const initial = props();
    if (!initial) return;
    dialog.open(() => props() ?? initial);
  };
}

/**
 * Returns an opener for a document's share modal when only its id is known,
 * e.g. from a view header outside the document.
 */
export function useDocumentShareModal(
  target: Accessor<
    | {
        documentId: string;
        blockAlias: BlockName | BlockAlias;
        copyLink?: () => void;
      }
    | undefined
  >
): () => void {
  const documentId = () => target()?.documentId ?? '';
  const metadataQuery = useDocumentMetadataQuery(documentId);
  const accessLevelQuery = useDocumentAccessLevelQuery(documentId);

  return useShareModal(() => {
    const current = target();
    if (!current) return;
    const metadata = queryReadyGate(metadataQuery)
      ? metadataQuery.data
      : undefined;
    const accessLevel = queryReadyGate(accessLevelQuery)
      ? accessLevelQuery.data
      : undefined;
    return {
      id: current.documentId,
      blockAlias: current.blockAlias,
      itemType: 'document',
      name: metadata?.documentName ?? '',
      owner: metadata?.owner,
      userPermissions: getPermissions(accessLevel),
      copyLink: current.copyLink,
    };
  });
}
