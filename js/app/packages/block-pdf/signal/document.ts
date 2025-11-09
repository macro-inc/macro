import { createBlockSignal, createBlockStore } from '@core/block';
import type { GetDocumentResponseDataViewLocation } from '@service-storage/generated/schemas/getDocumentResponseDataViewLocation';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { IModificationData } from '../type/coParse';

export const pdfDocumentProxy = createBlockSignal<PDFDocumentProxy>();
export const pdfViewLocation =
  createBlockSignal<GetDocumentResponseDataViewLocation>();

export const pdfModificationDataStore = createBlockStore<IModificationData>({
  bookmarks: [],
  placeables: [],
  pinnedTermsNames: [],
});
export const pdfOverlays = createBlockSignal<string[]>();
