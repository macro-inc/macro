import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  modeAllowed,
  type ReplyEligibility,
  type ReplyMode,
} from '../core/conversation';

/** Advance server time monotonically so a skewed browser clock cannot reopen a mode. */
export function createReplyEligibility(
  eligibility: Accessor<ReplyEligibility>
) {
  const snapshot = createMemo(() => {
    const value = eligibility();
    return {
      value,
      evaluatedAt: Date.parse(value.evaluated_at),
      receivedAt: performance.now(),
    };
  });
  const [tick, setTick] = createSignal(performance.now());
  onMount(() => {
    const timer = window.setInterval(() => setTick(performance.now()), 1000);
    onCleanup(() => window.clearInterval(timer));
  });
  return (mode: ReplyMode) => {
    const current = snapshot();
    const now =
      current.evaluatedAt +
      Math.max(0, Math.max(tick(), performance.now()) - current.receivedAt);
    return modeAllowed(current.value, mode, now);
  };
}
