export type CallLayout = 'auto' | 'grid' | 'speaker' | 'sidebar';

export function normalizeCallLayout(value: unknown): CallLayout {
  switch (value) {
    case 'grid':
    case 'speaker':
    case 'sidebar':
      return value;
    default:
      return 'auto';
  }
}

export function selectCallStageParticipant<T>(
  participants: readonly T[],
  speaking: (participant: T) => boolean,
  localSpeaking: boolean
): T | 'local' {
  return (
    participants.find(speaking) ??
    (localSpeaking ? 'local' : (participants[0] ?? 'local'))
  );
}
