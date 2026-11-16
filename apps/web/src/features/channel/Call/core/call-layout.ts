import { match } from 'ts-pattern';
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
  // A solo call still has its local participant.
  if (pin === 'local') return pin;
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
    if (!current || typeof current !== 'object') return false;
    return 'share' in current && current.share === target.share;
  }
  return current === target;
}

export function normalizeCallLayout(value: unknown): CallLayout {
  return match(value)
    .with('grid', 'speaker', 'sidebar', (layout) => layout)
    .otherwise(() => 'auto' as const);
}

export function selectCallStageParticipant<T>(
  participants: readonly T[],
  speaking: (participant: T) => boolean,
  localSpeaking: boolean
): T | 'local' {
  const active = participants.find(speaking);
  if (active !== undefined) return active;
  if (localSpeaking) return 'local';
  return participants[0] ?? 'local';
}

/** One shared stage/strip geometry for automatic, speaker and pinned placement. */
export function callStageGridStyle(
  count: number,
  sidebar: boolean,
  hidden: boolean
) {
  if (hidden)
    return {
      'grid-template-columns': 'minmax(0,1fr)',
      'grid-template-rows': 'minmax(0,1fr)',
    };
  if (sidebar)
    return {
      'grid-template-columns': 'minmax(0,1fr) minmax(0,9rem)',
      'grid-template-rows': `repeat(${Math.max(1, count)}, minmax(0,5.0625rem)) minmax(0,1fr)`,
    };
  return {
    'grid-template-columns': `minmax(0,1fr) repeat(${Math.max(1, count)},minmax(0,9rem)) minmax(0,1fr)`,
    'grid-template-rows': 'minmax(0,1fr) 6rem',
  };
}

export function callTileGridPosition(
  stage: boolean,
  index: number,
  count: number,
  sidebar: boolean
) {
  if (stage)
    return {
      'grid-column': sidebar ? '1' : '1 / -1',
      'grid-row': sidebar ? `1 / span ${Math.max(1, count) + 1}` : '1',
    };
  return {
    'grid-column': sidebar ? '2' : String(index + 2),
    'grid-row': sidebar ? String(index + 1) : '2',
  };
}
