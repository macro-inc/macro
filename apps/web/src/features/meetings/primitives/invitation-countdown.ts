import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { MEETING_INVITATION_RING_MS } from '../core/meeting-invitations';

/** Wall-clock time keeps the bar aligned with dismissal after a background tab resumes. */
export function createInvitationCountdown(expiresAt: Accessor<string>) {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 100);
  onCleanup(() => clearInterval(timer));

  return () =>
    Math.max(
      0,
      Math.min(MEETING_INVITATION_RING_MS, Date.parse(expiresAt()) - now())
    );
}
