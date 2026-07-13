import { createSignal } from 'solid-js';

export type ShareInboxConflictRequest = {
  emailAddress: string;
  ownerEmail: string;
  onShare: () => void;
};

/**
 * Pending shared-inbox confirmation for link flows that complete outside the
 * `/inbox-link-callback` route (native add-inbox). The web callback route
 * renders its own dialog because closing it also navigates away.
 */
const [shareInboxConflict, setShareInboxConflict] =
  createSignal<ShareInboxConflictRequest | null>(null);

export { shareInboxConflict };

export const requestShareInboxConfirmation = (
  request: ShareInboxConflictRequest
) => setShareInboxConflict(request);

export const dismissShareInboxConfirmation = () => setShareInboxConflict(null);
