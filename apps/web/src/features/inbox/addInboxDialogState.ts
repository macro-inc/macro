import { createSignal } from 'solid-js';

const [isOpen, setIsOpen] = createSignal(false);

/**
 * Requests the add-inbox confirmation dialog. Rendered at the app root
 * (Layout), gated on this signal, so it opens immediately and independent of
 * the settings surface.
 */
export const openAddInboxDialog = () => setIsOpen(true);

export const closeAddInboxDialog = () => setIsOpen(false);

export const isAddInboxDialogOpen = isOpen;
