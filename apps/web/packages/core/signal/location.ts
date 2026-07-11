import type { DocumentMentionLocation } from '@service-notification/client';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

export type TempRedirectLocation = {
  itemId: string;
  location: DocumentMentionLocation;
};

export const [tempRedirectLocation, setTempRedirectLocation] = makePersisted(
  createSignal<TempRedirectLocation>(),
  {
    name: 'macro-temp-redirect-location',
  }
);
