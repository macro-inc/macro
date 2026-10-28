import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  type IModificationData,
  type IModificationDataOnServer,
  transformModificationDataToClient,
} from '../type/coParse';
import type { IPlaceable } from '../type/placeables';

export function createPdfDocumentModel() {
  const [modificationData, setModificationData] =
    createStore<IModificationData>({
      bookmarks: [],
      placeables: [],
      pinnedTermsNames: [],
    });
  const [serverSnapshot, setServerSnapshot] =
    createSignal<IModificationDataOnServer>();
  const [revision, setRevision] = createSignal(0);

  const commands = {
    hydrateFromServer(snapshot: IModificationDataOnServer) {
      setServerSnapshot(snapshot);
      setModificationData(
        reconcile(transformModificationDataToClient(snapshot))
      );
    },
    replacePlaceables(placeables: IPlaceable[]) {
      setModificationData('placeables', reconcile(placeables));
    },
    appendPlaceable(placeable: IPlaceable) {
      setModificationData('placeables', (previous) => [...previous, placeable]);
    },
    updatePlaceable(index: number, candidate: IPlaceable) {
      if (index < 0) return false;

      const current = modificationData.placeables.at(index);
      if (!current || candidate.payloadType !== current.payloadType) {
        return false;
      }

      setModificationData('placeables', index, {
        ...candidate,
        wasEdited: true,
      });
      setRevision((previous) => previous + 1);
      return true;
    },
    removePlaceable(index: number) {
      if (index < 0 || index >= modificationData.placeables.length) {
        return false;
      }

      setModificationData('placeables', (previous) => [
        ...previous.slice(0, index),
        ...previous.slice(index + 1),
      ]);
      setRevision((previous) => previous + 1);
      return true;
    },
    recordEdit() {
      setRevision((previous) => previous + 1);
    },
  };

  return {
    modificationData,
    serverSnapshot,
    revision,
    hasServerSnapshot: () => serverSnapshot() != null,
    commands,
  };
}

export type PdfDocumentModel = ReturnType<typeof createPdfDocumentModel>;
