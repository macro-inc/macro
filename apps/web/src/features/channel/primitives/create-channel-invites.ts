import { type Accessor, createSignal } from 'solid-js';

export function createChannelInvites(props: {
  candidateIds: Accessor<string[]>;
  existingIds: Accessor<string[]>;
  ready: Accessor<boolean>;
  add: (ids: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const participantIds = () => {
    const existing = new Set(props.existingIds());
    return [...new Set(props.candidateIds())].filter((id) => !existing.has(id));
  };
  const canAdd = () =>
    !pending() && props.ready() && participantIds().length > 0;

  function close() {
    if (!pending()) props.onClose();
  }

  async function addPeople() {
    if (!canAdd()) return;
    const ids = participantIds();
    setPending(true);
    setError(undefined);
    try {
      await props.add(ids);
    } catch {
      setError('Could not add people to this channel. Try again.');
      setPending(false);
      return;
    }
    setPending(false);
    props.onClose();
  }

  return {
    pending,
    error,
    clearError: () => setError(undefined),
    participantIds,
    canAdd,
    close,
    addPeople,
  };
}
