import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { DesktopFaceSlot } from './views/face-slot';
import { MobileFaceSlot } from './views/mobile/face-slot';
import type { FaceSlotProps } from './views/shared/face-slot-props';

/**
 * An agent's picture while it is being chosen: its face (or photo), the ↻
 * that shuffles it, and its parts on a tap.
 */
export function FaceSlot(props: FaceSlotProps) {
  return (
    <Show when={isTouchDevice()} fallback={<DesktopFaceSlot {...props} />}>
      <MobileFaceSlot {...props} />
    </Show>
  );
}
