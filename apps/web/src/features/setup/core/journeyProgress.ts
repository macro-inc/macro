export const JOURNEY_STORAGE_KEY = 'macro-public-journey-v1';
export interface JourneyProgress {
  step: number;
  tools: string[];
  search: string;
  tour: number;
}
export const EMPTY_JOURNEY: JourneyProgress = {
  step: 0,
  tools: ['Notion', 'Google'],
  search: '',
  tour: 0,
};

/** Validate persisted data so old releases or unavailable storage never break entry. */
export function readJourney(
  storage: Pick<Storage, 'getItem'>
): JourneyProgress {
  try {
    const value = JSON.parse(storage.getItem(JOURNEY_STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { ...EMPTY_JOURNEY };
    return {
      step:
        Number.isInteger(value.step) && value.step >= 0 && value.step <= 7
          ? value.step
          : 0,
      tools: Array.isArray(value.tools)
        ? value.tools.filter((tool: unknown) => typeof tool === 'string')
        : [...EMPTY_JOURNEY.tools],
      search: typeof value.search === 'string' ? value.search : '',
      tour:
        Number.isInteger(value.tour) && value.tour >= 0 && value.tour < 6
          ? value.tour
          : 0,
    };
  } catch {
    return { ...EMPTY_JOURNEY };
  }
}

export function saveJourney(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  patch: Partial<JourneyProgress>
) {
  const next = { ...readJourney(storage), ...patch };
  try {
    storage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Private browsing can disable storage. */
  }
  return next;
}
