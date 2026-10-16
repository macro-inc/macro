import { ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { refetchHistory } from '@queries/history/history';
import { storageServiceClient } from '@service-storage/client';
import { createMemo } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { usePdfViewer } from '../context/pdf-viewer-context';
import {
  getSaveModificationData,
  hashModificationData,
  hashModificationDataSync,
} from '../util/buildModificationData';

export function useDoEdit() {
  return usePdfDocument().model.commands.recordEdit;
}

export function useHasModificationData() {
  const pdf = usePdfDocument();

  return () =>
    pdf.annotations.hasHighlights() ||
    pdf.model.modificationData.placeables.length > 0;
}

export function useSaveModificationData() {
  const pdf = usePdfDocument();
  const pdfModificationValue = pdf.model.modificationData;

  const serverModificationDataHash = createMemo(() => {
    const modificationData_ = pdf.model.serverSnapshot();
    if (!modificationData_) return '';
    const hash = hashModificationDataSync(modificationData_);
    return hash;
  });

  const shouldSave = () => {
    if (!ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE) return false;
    const placeables = pdfModificationValue.placeables ?? [];
    const { modificationData } = getSaveModificationData({
      placeables,
      pinnedTerms: [],
    });
    const sha = hashModificationDataSync(modificationData);
    return pdf.permissions.canEdit() && serverModificationDataHash() !== sha;
  };

  const save = async () => {
    const placeables = pdfModificationValue.placeables ?? [];
    const { modificationData } = getSaveModificationData({
      placeables,
      pinnedTerms: [],
    });

    const sha = await hashModificationData(modificationData);
    const result = await storageServiceClient.pdfSave({
      documentId: pdf.documentId(),
      modificationData,
      sha,
    });
    if (result.isErr()) throw new Error('Could not save PDF changes');
    await refetchHistory();
  };

  return (options?: { throwOnError?: boolean }) =>
    pdf.persistence.runSave(save, shouldSave, options);
}

export function usePdfSaveLocation() {
  const pdf = usePdfDocument();
  const viewer = usePdfViewer().root.instance;
  const prevLocationHash = pdf.persistedViewLocation;
  const userId = useUserId();

  const shouldSave = () => {
    const userId_ = userId();
    if (!userId_) return false;

    const location = viewer()?.getLocationHash();
    return location != null && prevLocationHash() !== location;
  };

  const save = async () => {
    const location = viewer()?.getLocationHash();
    if (location == null) {
      const result = await storageServiceClient.deleteDocumentViewLocation({
        documentId: pdf.documentId(),
      });
      if (result.isErr()) throw new Error('Could not save PDF view location');
    } else {
      const result = await storageServiceClient.upsertDocumentViewLocation({
        documentId: pdf.documentId(),
        location,
      });
      if (result.isErr()) throw new Error('Could not save PDF view location');
    }
    pdf.setPersistedViewLocation(location);
  };

  return (options?: { throwOnError?: boolean }) =>
    pdf.persistence.runSave(save, shouldSave, options);
}

export const usePdfSave = () => {
  const pdf = usePdfDocument();
  const saveLocation = usePdfSaveLocation();
  const saveModificationData = useSaveModificationData();

  const save = async (options?: { throwOnError?: boolean }) => {
    if (options?.throwOnError) await pdf.persistence.waitForSaves();
    await Promise.all([saveLocation(options), saveModificationData(options)]);
  };

  return save;
};
