import { createSignal } from 'solid-js';
import type {
  NewMeeting,
  NewMeetingCapabilities,
} from '../context/new-meeting';

const MAX_INVITEES = 50;

/** Draft selection is local; only Start Call prepares a persistent meeting. */
export function createNewMeeting(capabilities: NewMeetingCapabilities) {
  const [meeting, setMeeting] = createSignal<NewMeeting>();
  const [selected, setSelected] = createSignal(new Set<string>());
  const [selectionError, setSelectionError] = createSignal<string>();
  const [inviteError, setInviteError] = createSignal<string>();
  const [inviting, setInviting] = createSignal(false);
  const sent = new Set<string>();
  let recipients: string[] = [];
  let attemptSignal: AbortSignal | undefined;

  function select(values: Set<string>) {
    const eligible = new Set(capabilities.people().map((person) => person.id));
    const next = new Set([...values].filter((id) => eligible.has(id)));
    if (next.size > MAX_INVITEES) {
      setSelectionError('You can invite up to 50 teammates at a time.');
      return;
    }
    setSelectionError(undefined);
    setSelected(next);
  }

  async function prepare(signal: AbortSignal) {
    attemptSignal = signal;
    if (signal.aborted) return;
    const eligible = new Set(capabilities.people().map((person) => person.id));
    recipients = [...selected()].filter(
      (id) => eligible.has(id) && !sent.has(id)
    );
    setInviteError(undefined);
    // A retry after a cancelled/failed join keeps the already-created link.
    if (!meeting()) setMeeting(await capabilities.create());
  }

  /** Invitation failure does not tear down a successfully connected call. */
  async function ring() {
    const created = meeting();
    if (!created || attemptSignal?.aborted || inviting() || !recipients.length)
      return;
    const batch = [...recipients];
    setInviting(true);
    setInviteError(undefined);
    try {
      await capabilities.invite(created.shareToken, batch);
      for (const id of batch) sent.add(id);
      recipients = recipients.filter((id) => !sent.has(id));
    } catch {
      setInviteError(
        'Your call started, but the invitations could not be sent.'
      );
    } finally {
      setInviting(false);
    }
  }

  return {
    meeting,
    selected,
    select,
    selectionError,
    inviteError,
    inviting,
    prepare,
    ring,
  };
}
