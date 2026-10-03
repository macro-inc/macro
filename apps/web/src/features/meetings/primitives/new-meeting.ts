import { createSignal, onCleanup } from 'solid-js';
import type {
  MeetingPreparation,
  NewMeeting,
  NewMeetingCapabilities,
} from '../context/new-meeting';

const MAX_INVITEES = 50;

/** Setup reserves an empty room; only Start Call creates a meeting and invitations. */
export function createNewMeeting(capabilities: NewMeetingCapabilities) {
  const [meeting, setMeeting] = createSignal<NewMeeting>();
  const [selected, setSelected] = createSignal(new Set<string>());
  const [selectionError, setSelectionError] = createSignal<string>();
  const [inviteError, setInviteError] = createSignal<string>();
  const [inviting, setInviting] = createSignal(false);
  const sent = new Set<string>();
  let recipients: string[] = [];
  let attemptSignal: AbortSignal | undefined;
  let reservation: MeetingPreparation | undefined;
  let warming: Promise<void> | undefined;
  let disposed = false;
  let preparationGeneration = 0;

  async function cancelRoom(id: string) {
    try {
      await capabilities.cancelRoom(id);
    } catch {
      // The server also expires unused rooms if the browser goes offline.
    }
  }

  function cancel() {
    preparationGeneration += 1;
    if (reservation) void cancelRoom(reservation.id);
    reservation = undefined;
    warming = undefined;
  }
  onCleanup(() => {
    disposed = true;
    cancel();
  });

  function warmup(): Promise<void> {
    if (disposed || meeting() || reservation) return Promise.resolve();
    if (warming) return warming;
    const generation = preparationGeneration;
    warming = (async () => {
      try {
        const room = await capabilities.prepareRoom();
        if (disposed || generation !== preparationGeneration)
          await cancelRoom(room.id);
        else reservation = room;
      } catch {
        // Starting still works through the normal room creation path.
      } finally {
        if (generation === preparationGeneration) warming = undefined;
      }
    })();
    return warming;
  }

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
    if (!meeting()) {
      const generation = preparationGeneration;
      await warming;
      if (signal.aborted || disposed) return;
      if (generation !== preparationGeneration)
        throw new Error('Call setup closed');
      const room = reservation;
      const preparationId =
        room && Date.parse(room.expiresAt) > Date.now() ? room.id : undefined;
      setMeeting(await capabilities.create(preparationId));
      reservation = undefined;
    }
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
    warmup,
    cancel,
    ring,
  };
}
