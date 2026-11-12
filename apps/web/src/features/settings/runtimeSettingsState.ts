import { createSignal } from 'solid-js';

/**
 * Asks Settings → Runtimes to point out one runtime, with its Share menu open
 * when `share` is set (an access request waits there).
 */
export type RuntimeShareRequest = {
  id: number;
  harnessId: string;
  share: boolean;
};

const [runtimeShareRequest, setRuntimeShareRequest] =
  createSignal<RuntimeShareRequest>();
let nextRequestId = 0;

export { runtimeShareRequest };

export function requestRuntimeShare(harnessId: string, share: boolean) {
  setRuntimeShareRequest({ id: ++nextRequestId, harnessId, share });
}

export function consumeRuntimeShareRequest(id: number) {
  if (runtimeShareRequest()?.id === id) setRuntimeShareRequest(undefined);
}
