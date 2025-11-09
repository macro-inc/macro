import type { ItemType } from '@service-storage/client';
import { createSignal } from 'solid-js';

export const [copiedItem, setCopiedItem] = createSignal<{
  id: string;
  type: ItemType;
}>();
