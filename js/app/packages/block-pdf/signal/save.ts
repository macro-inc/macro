import type { IModificationDataOnServer } from '@block-pdf/type/coParse';
import { createBlockSignal, useBlockId } from '@core/block';
import { ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE } from '@core/constant/featureFlags';
import { useUserId } from '@service-gql/client';
import { storageServiceClient } from '@service-storage/client';
import { refetchHistory } from '@service-storage/history';
import { createMemo } from 'solid-js';
import { highlightStore } from '../store/highlight';
import { useTableOfContentsValue } from '../store/tableOfContents';
import {
  getSaveModificationData,
  hashModificationData,
  hashModificationDataSync,
} from '../util/buildModificationData';
import { pdfModificationDataStore, pdfViewLocation } from './document';
import { useGetRootViewer } from './pdfViewer';
import { useCanEditModificationData } from './permissions';

export const numOperations = createBlockSignal(0);
const savingCountSignal = createBlockSignal(0);
export const isSaving = createBlockSignal(false);
export const modificationDataSaveRequired = createBlockSignal(false);
export const serverModificationDataSignal =
  createBlockSignal<IModificationDataOnServer>();
export function useDoEdit() {
  const setNumOperations = numOperations.set;
  return () => setNumOperations((prev) => prev + 1);
}

const useSaveWrapper = () => {
  const setIsSaving = isSaving.set;
  const [savingCount, setSaveCount] = savingCountSignal;

  return (save: () => Promise<void>, shouldSave: () => boolean) => {
    return async () => {
      let saving = false;
      try {
        if (!shouldSave()) return;
        saving = true;
        setIsSaving(true);
        setSaveCount((prev) => prev + 1);
        await save();
      } catch (e) {
        console.error('Error saving PDF', e);
      } finally {
        if (saving) {
          const count = savingCount() - 1;
          setSaveCount(count);
          if (count === 0) {
            setIsSaving(false);
          }
        }
      }
    };
  };
};

export function useHasModificationData() {
  const highlightStoreValue = highlightStore.get;
  const pdfModificationValue = pdfModificationDataStore.get;

  return () =>
    Object.keys(highlightStoreValue).length > 0 ||
    pdfModificationValue.placeables.length > 0;
}

export function useSaveModificationData() {
  const saveWrapper = useSaveWrapper();
  const pdfModificationValue = pdfModificationDataStore.get;
  const tableOfContentsValue = useTableOfContentsValue();
  const documentId = useBlockId();
  const serverModificationData = serverModificationDataSignal.get;
  const canSave = useCanEditModificationData();

  const serverModificationDataHash = createMemo(() => {
    const modificationData_ = serverModificationData();
    if (!modificationData_) return '';
    const hash = hashModificationDataSync(modificationData_);
    return hash;
  });

  const shouldSave = () => {
    if (!ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE) return false;
    const placeables = pdfModificationValue.placeables ?? [];
    const { modificationData } = getSaveModificationData({
      placeables,
      TOCItems: tableOfContentsValue().items,
      pinnedTerms: [],
    });
    const sha = hashModificationDataSync(modificationData);
    return canSave() && serverModificationDataHash() !== sha;
  };

  const save = async () => {
    const placeables = pdfModificationValue.placeables ?? [];
    const { modificationData } = getSaveModificationData({
      placeables,
      TOCItems: tableOfContentsValue().items,
      pinnedTerms: [],
    });

    const serverSaves: Promise<any>[] = [];

    const sha = await hashModificationData(modificationData);
    serverSaves.push(
      storageServiceClient.pdfSave({
        documentId,
        modificationData,
        sha,
      })
    );
    serverSaves.push(refetchHistory());

    await Promise.all(serverSaves);
  };

  const wrapped = saveWrapper(save, shouldSave);

  return wrapped;
}

export function usePdfSaveLocation() {
  const saveWrapper = useSaveWrapper();
  const viewer = useGetRootViewer();
  const [prevLocationHash, setPrevLocationHash] = pdfViewLocation;
  const documentId = useBlockId();
  const userId = useUserId();

  const shouldSave = () => {
    const userId_ = userId();
    if (!userId_) return false;

    const location = viewer()?.getLocationHash();
    return location != null && prevLocationHash() !== location;
  };

  const save = async () => {
    const location = viewer()?.getLocationHash();
    setPrevLocationHash(location);
    if (location == null) {
      await storageServiceClient.deleteDocumentViewLocation({
        documentId,
      });
    } else {
      await storageServiceClient.upsertDocumentViewLocation({
        documentId,
        location,
      });
    }
  };

  const wrapped = saveWrapper(save, shouldSave);

  return wrapped;
}

export const usePdfSave = () => {
  const saveLocation = usePdfSaveLocation();
  const saveModificationData = useSaveModificationData();

  const save = async () => {
    await Promise.all([saveLocation(), saveModificationData()]);
  };

  return save;
};
