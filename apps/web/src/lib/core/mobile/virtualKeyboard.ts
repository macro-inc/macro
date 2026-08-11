import { createSignal } from 'solid-js';

/**
 * Detail payload of the native `keyboardWillShow`/`keyboardWillHide`
 * CustomEvents dispatched by tauri-plugin-virtual-keyboard. `duration` is the
 * keyboard animation duration in seconds (UIKit's
 * keyboardAnimationDurationUserInfoKey); `height` is absent on hide.
 */
export type VirtualKeyboardEvent = CustomEventInit<{
  height?: number;
  duration: number;
}>;

export const [virtualKeyboardVisible, setVirtualKeyboardVisible] =
  createSignal(false);

export const [virtualKeyboardHeight, setVirtualKeyboardHeight] =
  createSignal(0);
