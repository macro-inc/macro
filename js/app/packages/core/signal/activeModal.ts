import { createSignal } from 'solid-js';

export type ActiveModal = 'login';
export const [activeModal, setActiveModal] = createSignal<ActiveModal>();
