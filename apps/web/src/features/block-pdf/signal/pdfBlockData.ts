import { blockDataSignalAs } from '@core/block';
import type { PdfBlockData } from '../definition';

// You really shouldn't use this unless you REALLY need to
// Instead, use the signals in document.ts
export const pdfBlockDataSignal = blockDataSignalAs<PdfBlockData>('pdf');
