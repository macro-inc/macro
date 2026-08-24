import { UNIFIED_CHANNEL_INPUT } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * Whether the channel is in unified-input mode: one floating input handles
 * channel messages, thread replies, and message edits, with a flag above it
 * naming the current target. When off, threads render inline inputs instead
 * (thread-reply inputs inside each thread, in-place message editing).
 *
 * Always on for touch devices (phone and tablet alike — an iPad is wider than
 * the mobile breakpoint but drives the same one-input-at-a-time UX); on
 * desktop behind `DISABLE_INLINE_INPUTS`.
 * Reactive: `isTouchDevice()` is signal-backed, so this flips if the pointer
 * type changes.
 */
export function isUnifiedInputMode(): boolean {
  return isTouchDevice() || UNIFIED_CHANNEL_INPUT;
}
