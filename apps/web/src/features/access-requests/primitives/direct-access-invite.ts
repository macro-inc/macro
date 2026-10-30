import { emailToMacroId } from '@app/lib/identity/macro-id';
import { createSignal, onCleanup } from 'solid-js';
import type { SharingSource } from '../context/contracts';

/** Direct people invitations for entities that do not forward through channels. */
export function createDirectAccessInvite(source: SharingSource) {
  const [email, setEmail] = createSignal('');
  const [notice, setNotice] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  const invite = async () => {
    const userId = emailToMacroId(email().trim().toLowerCase());
    if (!userId || !source.state()?.canReview || source.busy()) return;
    setNotice(undefined);
    setError(undefined);
    try {
      await source.setGrant(userId, 'view');
      if (!alive) return;
      setEmail('');
      setNotice('View access added.');
    } catch {
      if (alive)
        setError(
          "Couldn't add this person. Check their Macro email and try again."
        );
    }
  };
  return { email, setEmail, notice, error, invite };
}
