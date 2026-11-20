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
  type CallPreviewPin,
  selectCallPreview,
} from '../core/call-mini-player';

export const CALL_SPEAKER_HOLD_MS = 650;

/** Hold speaker switches, but apply pins, unpins, shares and departures immediately. */
export function createHeldCallPreview<T extends CallPreviewParticipant>(
  participants: Accessor<readonly T[]>,
  reducedMotion: Accessor<boolean>,
  pin: Accessor<CallPreviewPin | undefined> = () => undefined
): Accessor<T | undefined> {
  const [id, setId] = createSignal<string>();
  const desired = createMemo(
    () => selectCallPreview(participants(), pin())?.id
  );
  const present = createMemo(() =>
    participants().some((person) => person.id === id())
  );
  // Restart the hold when the desired speaker changes. Explicit pin changes,
  // shares and departures bypass it; cleanup cancels any pending switch.
  createEffect(
    on(
      [desired, reducedMotion, present, pin],
      ([next, reduced, currentPresent, pinned], previous) => {
        if (next === id()) return;
        const target = participants().find((person) => person.id === next);
        const pinChanged = pinned !== previous?.[3];
        const immediate = !currentPresent || !target || !!pinned || pinChanged;
        const skipMotion = reduced || target?.sharing;
        if (immediate || skipMotion) {
          setId(next);
          return;
        }
        const timer = setTimeout(() => setId(next), CALL_SPEAKER_HOLD_MS);
        onCleanup(() => clearTimeout(timer));
      }
    )
  );
  return () =>
    participants().find((person) => person.id === id()) ??
    selectCallPreview(participants(), pin());
}
