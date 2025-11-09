import { createBlockSignal } from '@core/block';
import type { Item } from '@service-storage/generated/schemas/item';

export const blockSelectedItems = createBlockSignal<Item[]>([]);
