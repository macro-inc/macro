import {
  createBlockEffect,
  createBlockResource,
  useBlockId,
  useBlockName,
} from '@core/block';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { blockNameToItemType } from '@service-storage/client';
import { createSignal, onCleanup } from 'solid-js';
import {
  fetchSharePermissions,
  invalidateSharePermissions,
} from './share-permissions';

export const permissionsBlockResource = createBlockResource(
  () => {
    const isOwner = useIsDocumentOwner();
    return isOwner();
  },
  async () => {
    const id = useBlockId();
    const blockName = useBlockName();
    const itemType = blockNameToItemType(blockName);
    return fetchSharePermissions(id, itemType);
  },
  { initialValue: undefined }
);

createBlockEffect(() => {
  const [, { refetch }] = permissionsBlockResource;
  setRefetchArray((prev) => [...prev, refetch]);
  onCleanup(() => {
    setRefetchArray((prev) => prev.filter((r) => r !== refetch));
  });
});

const [refetchArray, setRefetchArray] = createSignal<(() => void)[]>([]);
export const refetchBlockSharePermissions = () => {
  invalidateSharePermissions();
  const refetchArray_ = refetchArray();
  if (refetchArray_.length === 0) {
    console.warn('no document share permission refetch functions initialized');
    return;
  }
  refetchArray_.forEach((refetch) => refetch());
};
