export type CallLayout = 'auto' | 'grid' | 'speaker' | 'sidebar';
export type CallPin<T extends object> =
  | T
  | 'local'
  | 'local-share'
  | { share: T };

export function activeCallPin<T extends object>(
  pin: CallPin<T> | undefined,
  participants: readonly T[],
  shares: readonly T[],
  localSharing: boolean
): CallPin<T> | undefined {
  if (pin === 'local') return participants.length ? pin : undefined;
  if (pin === 'local-share') return localSharing ? pin : undefined;
  if (pin && 'share' in pin)
    return shares.includes(pin.share) ? pin : undefined;
  return pin && participants.includes(pin) ? pin : undefined;
}

export function sameCallPin<T extends object>(
  current: CallPin<T> | undefined,
  target: CallPin<T>
): boolean {
  if (typeof target === 'object' && 'share' in target) {
    return (
      !!current &&
      typeof current === 'object' &&
      'share' in current &&
      current.share === target.share
    );
  }
  return current === target;
}

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
