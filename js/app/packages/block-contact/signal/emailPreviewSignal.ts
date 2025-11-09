import { createBlockSignal } from '@core/block';
import type { ThreadPreview } from '@core/types';

export const emailPreviewsSignal = createBlockSignal<ThreadPreview[]>([]);
export const isLoadingPreviewsSignal = createBlockSignal(false);
export const hasMorePreviewsSignal = createBlockSignal(true);
