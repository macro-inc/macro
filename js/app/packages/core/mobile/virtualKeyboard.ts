import { createSignal } from 'solid-js';

export const [virtualKeyboardVisible, setVirtualKeyboardVisible] =
  createSignal(false);

export const [virtualKeyboardHeight, setVirtualKeyboardHeight] =
  createSignal(0);
