import {
  makePersistedState,
  type PersistenceStorage,
} from '@app/lib/persistence';
import { ComputerSize } from '@service-auth/generated/schemas';
import { createSignal } from 'solid-js';
import { z } from 'zod';

const STORAGE_KEY = 'macro:agent-invite-draft';

const draftSchema = z.object({
  teamId: z.string().min(1),
  name: z.string(),
  size: z.enum(ComputerSize).optional(),
});

/** An Invite an agent form put aside to update the card. */
export type AgentInviteDraft = z.infer<typeof draftSchema>;

/**
 * Kept in this tab's sessionStorage, so it survives Billing and the card
 * page's full-page round trip. Storage failures only lose the draft.
 */
const DRAFT_STORAGE: PersistenceStorage<AgentInviteDraft | undefined> = {
  restore: () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      const result = draftSchema.safeParse(JSON.parse(raw));
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  },
  write: (draft) => {
    try {
      if (draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Unavailable storage only loses the draft.
    }
  },
};

/**
 * The name and size an admin had typed when a declined card sent them to
 * Billing, for the team they were inviting to. The next Invite an agent for
 * that team starts from it; adding the agent or cancelling forgets it.
 */
export function createAgentInviteDraft(teamId: string) {
  const [draft, setDraft] = makePersistedState(
    createSignal<AgentInviteDraft>(),
    { storages: DRAFT_STORAGE }
  );
  const saved = draft();
  return {
    /** What to start the form from, read once as the form opens. */
    initial: saved?.teamId === teamId ? saved : undefined,
    save: (name: string, size: ComputerSize | undefined) =>
      setDraft({ teamId, name, size }),
    forget: () => setDraft(undefined),
  };
}
