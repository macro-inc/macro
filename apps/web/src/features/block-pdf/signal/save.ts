import { ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { refetchHistory } from '@queries/history/history';
import { storageServiceClient } from '@service-storage/client';
import { createMemo } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import {
  getSaveModificationData,
  hashModificationData,
  hashModificationDataSync,
} from '../util/buildModificationData';

export function useDoEdit() {
  const [, setNumOperations] = usePdfDocument().state.signals.numOperations;
  return () => setNumOperations((prev) => prev + 1);
}

const useSaveWrapper = () => {
  const { isSaving, savingCount } = usePdfDocument().state.signals;
  const [, setIsSaving] = isSaving;
  const [getSavingCount, setSavingCount] = savingCount;

  return (save: () => Promise<void>, shouldSave: () => boolean) => {
    return async () => {
      let saving = false;
      try {
        if (!shouldSave()) return;
        saving = true;
        setIsSaving(true);
        setSavingCount((prev) => prev + 1);
        await save();
      } catch (e) {
        console.error('Error saving PDF', e);
      } finally {
        if (saving) {
          const count = getSavingCount() - 1;
          setSavingCount(count);
          if (count === 0) {
            setIsSaving(false);
          }
        }
      }
    };
  };
};

export function useHasModificationData() {
  const { highlights, modificationData } = usePdfDocument().state.stores;
  const [highlightStoreValue] = highlights;
  const [pdfModificationValue] = modificationData;

  return () =>
    Object.keys(highlightStoreValue).length > 0 ||
    pdfModificationValue.placeables.length > 0;
}

export function useSaveModificationData() {
  const pdf = usePdfDocument();
  const saveWrapper = useSaveWrapper();
  const [pdfModificationValue] = pdf.state.stores.modificationData;
  const [tableOfContents] = pdf.state.stores.tableOfContents;
  const [serverModificationData] = pdf.state.signals.serverModificationData;

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
      TOCItems: tableOfContents.items,
      pinnedTerms: [],
    });
    const sha = hashModificationDataSync(modificationData);
    return pdf.permissions.canEdit() && serverModificationDataHash() !== sha;
  };

  const save = async () => {
    const placeables = pdfModificationValue.placeables ?? [];
    const { modificationData } = getSaveModificationData({
      placeables,
      TOCItems: tableOfContents.items,
      pinnedTerms: [],
    });

    const serverSaves: Promise<any>[] = [];

    const sha = await hashModificationData(modificationData);
    serverSaves.push(
      storageServiceClient.pdfSave({
        documentId: pdf.documentId(),
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
  const pdf = usePdfDocument();
  const saveWrapper = useSaveWrapper();
  const [viewer] = pdf.state.signals.rootViewer;
  const [prevLocationHash, setPrevLocationHash] =
    pdf.state.signals.viewLocation;
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
        documentId: pdf.documentId(),
      });
    } else {
      await storageServiceClient.upsertDocumentViewLocation({
        documentId: pdf.documentId(),
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
