import { createSignal } from 'solid-js';

// Kept outside ShareButton so storage cache refreshes do not import the share
// modal and its editor/forwarding dependencies.
const [refetchers, setRefetchers] = createSignal<Array<() => void>>([]);

export function addShareButtonRefetch(refetch: () => void) {
  setRefetchers((current) => [...current, refetch]);
}

export function removeShareButtonRefetch(refetch: () => void) {
  setRefetchers((current) => current.filter((item) => item !== refetch));
}

export function refetchDocumentShareButtonResource() {
  const current = refetchers();
  if (current.length === 0) {
    console.warn('no document share permission refetch functions initialized');
    return;
  }
  current.forEach((refetch) => refetch());
}
