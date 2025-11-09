import { createBlockSignal } from '@core/block';
import type { Attachment } from '@service-comms/generated/models/attachment';

export const sharedFilesSignal = createBlockSignal<Attachment[]>([]);
export const isLoadingFilesSignal = createBlockSignal(false);
export const channelIdSignal = createBlockSignal<string | null>(null);
