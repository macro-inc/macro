import { createSignal } from 'solid-js';
import { makePersisted } from '@solid-primitives/storage';

const BEVELED_CORNERS_DEFAULT = true;

export const [beveledCorners, setBeveledCorners] = makePersisted(
  createSignal<boolean>(BEVELED_CORNERS_DEFAULT),
  { name: 'macro-beveled-corners' }
);
