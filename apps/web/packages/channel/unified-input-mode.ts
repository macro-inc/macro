import { UNIFIED_CHANNEL_INPUT } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';

/**
 * Whether the channel is in unified-input mode: one floating input handles
 * channel messages, thread replies, and message edits, with a flag above it
 * naming the current target. When off, threads render inline inputs instead
 * (thread-reply inputs inside each thread, in-place message editing).
 *
 * Always on for mobile; on desktop behind `DISABLE_INLINE_INPUTS`.
 * Reactive: `isMobile()` is signal-backed, so this flips on viewport resize.
 */
export function isUnifiedInputMode(): boolean {
  return isMobile() || UNIFIED_CHANNEL_INPUT;
}
