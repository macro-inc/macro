import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  type CallPreviewParticipant,
  selectCallPreview,
} from '../core/call-mini-player';

export const CALL_SPEAKER_HOLD_MS = 650;

/** Keep short speech gaps from repeatedly replacing the preview. Shares take priority immediately. */
export function createHeldCallPreview<T extends CallPreviewParticipant>(
  participants: Accessor<readonly T[]>,
  reducedMotion: Accessor<boolean>
): Accessor<T | undefined> {
  const [id, setId] = createSignal<string>();
  const desired = createMemo(() => selectCallPreview(participants())?.id);
  const present = createMemo(() =>
    participants().some((person) => person.id === id())
  );
  // Restart the hold when the desired speaker changes. Shares and departures
  // bypass the timer; cleanup cancels an old speaker's pending switch.
  createEffect(
    on([desired, reducedMotion, present], ([next, reduced, currentPresent]) => {
      if (next === id()) return;
      const target = participants().find((person) => person.id === next);
      if (!currentPresent || !target || target.sharing || reduced) {
        setId(next);
        return;
      }
      const timer = setTimeout(() => setId(next), CALL_SPEAKER_HOLD_MS);
      onCleanup(() => clearTimeout(timer));
    })
  );
  return () =>
    participants().find((person) => person.id === id()) ??
    selectCallPreview(participants());
}
