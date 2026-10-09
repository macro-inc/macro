import type { Attachment, Model } from '@core/component/AI/types';
import { createSignal } from 'solid-js';
import type { ModelSpeed } from '../constant/speed';

export type PendingSend = {
  content: string;
  attachments: Attachment[];
  model: Model;
  speed?: ModelSpeed;
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

// Read the pending send without clearing it. Used to seed UI state (e.g. the
// model selector) before the pending send is consumed for the actual send.
export function peekPendingSend(): PendingSend | null {
  return pendingSend();
}

export function setPendingSendData(send: PendingSend): void {
  setPendingSend(send);
}
