import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

/** Browser preference shared by all composers; unsupported models still use standard speed. */
export const [fastModeEnabled, setFastModeEnabled] = makePersisted(
  createSignal(false),
  {
    name: 'macro:ai-fast-mode',
    deserialize: (value) => value === 'true',
  }
);
