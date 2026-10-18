import { useFocusLock } from '@core/util/createControlledOpenSignal';
import { createSignal } from 'solid-js';

export const [newChannelModalOpen, setNewChannelModalOpen] =
  createSignal(false);
export const newChannelModalFocusLock = useFocusLock('create-channel');

export function openNewChannelModal() {
  newChannelModalFocusLock.acquire();
  setNewChannelModalOpen(true);
}
