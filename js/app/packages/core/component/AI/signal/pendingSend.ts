import type { Attachment, Model } from '@core/component/AI/types';
import { createSignal } from 'solid-js';

export type PendingSend = {
  content: string;
  attachments: Attachment[];
  model: Model;
};

const [pendingSend, setPendingSend] = createSignal<PendingSend | null>(null);

export function getPendingSend(): PendingSend | null {
  const pending = pendingSend();
  if (pending) {
    // Clear it once retrieved
    setPendingSend(null);
    return pending;
  }
  return null;
}

export function setPendingSendData(send: PendingSend): void {
  setPendingSend(send);
}
