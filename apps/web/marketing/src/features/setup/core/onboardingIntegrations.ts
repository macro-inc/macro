import { onboardingIntegrationAvailable } from './onboardingIntegrationCatalog';

/** A selected catalog item. Connection URLs always come from trusted app config. */
export interface OnboardingIntegration {
  id: string;
  name: string;
  iconUrl?: string;
}

const STORAGE_PREFIX = 'macro:onboarding-integrations:';

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

/** OAuth may leave the page, so keep the selected steps scoped to this account. */
export function readOnboardingIntegrations(
  storage: Pick<Storage, 'getItem'>,
  userId: string
): OnboardingIntegration[] {
  try {
    const stored: unknown = JSON.parse(
      storage.getItem(storageKey(userId)) ?? '[]'
    );
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    return stored.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      if (
        typeof entry.id !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]*$/.test(entry.id) ||
        !onboardingIntegrationAvailable(entry.id) ||
        typeof entry.name !== 'string' ||
        !entry.name.trim() ||
        seen.has(entry.id)
      )
        return [];
      seen.add(entry.id);
      return [
        {
          id: entry.id,
          name: entry.name,
          ...(typeof entry.iconUrl === 'string'
            ? { iconUrl: entry.iconUrl }
            : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function writeOnboardingIntegrations(
  storage: Pick<Storage, 'setItem'>,
  userId: string,
  items: readonly OnboardingIntegration[]
): void {
  try {
    storage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    // The current session remains usable when browser storage is unavailable.
  }
}
