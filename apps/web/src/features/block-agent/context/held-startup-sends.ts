/**
 * First prompts a lost create may have started, for a block with no session
 * to show them in: its create failed, or (after a reload of a create that
 * never landed) its load failed or was refused. Holds are per person, so a
 * refused load shows only the viewer's own.
 */

import {
  dropUnconfirmedSends,
  heldSendsAt,
  subscribeUnconfirmedSends,
  type UnconfirmedSend,
  unconfirmedSends,
} from '@core/agent-session/unconfirmed-sends';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

export function createHeldStartupSends(options: {
  blockId: Accessor<string>;
  /** Where this tab's create held its prompt, while it remembers. */
  heldId: Accessor<string | undefined>;
  userId: Accessor<string | undefined>;
  /** The block has no session to show: a failed create or load. */
  unavailable: Accessor<boolean>;
}) {
  const [held, setHeld] = createSignal<UnconfirmedSend[]>([]);
  // After a reload only the recorded pointer knows a fallback id.
  const at = () =>
    options.heldId() ?? heldSendsAt(options.blockId(), options.userId());
  createEffect(() => {
    if (!options.unavailable()) {
      setHeld([]);
      return;
    }
    const id = at();
    const user = options.userId();
    const read = () => setHeld(unconfirmedSends(id, user));
    read();
    onCleanup(subscribeUnconfirmedSends(id, read));
  });
  return {
    held,
    drop: (actionId: string) => dropUnconfirmedSends(at(), [actionId]),
  };
}
