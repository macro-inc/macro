import { createSignal } from 'solid-js';

/**
 * The search parameter that reopens a computer's guided setup from a link:
 * `/settings/runtimes?computerSetup=<computer id>`. A computer setup
 * notification links here, so a cold start lands in the same place.
 */
export const COMPUTER_SETUP_PARAM = 'computerSetup';

/** The computer id a `computerSetup` parameter names, if it names one. */
export function parseComputerSetupParam(value: unknown): string | undefined {
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined;
}

/** The link that reopens `computerId`'s guided setup at Bring your AI. */
export function computerSetupPath(computerId: string): string {
  return `/settings/runtimes?${COMPUTER_SETUP_PARAM}=${encodeURIComponent(computerId)}`;
}

/**
 * Asks Settings → Machines to reopen one computer's guided setup at Bring
 * your AI, where a computer that just came up continues and a failed one
 * offers Retry setup.
 */
export type ComputerSetupRequest = { id: number; computerId: string };

const [computerSetupRequest, setComputerSetupRequest] =
  createSignal<ComputerSetupRequest>();
let nextRequestId = 0;

export { computerSetupRequest };

export function requestComputerSetup(computerId: string) {
  setComputerSetupRequest({ id: ++nextRequestId, computerId });
}

export function consumeComputerSetupRequest(id: number) {
  if (computerSetupRequest()?.id === id) setComputerSetupRequest(undefined);
}
