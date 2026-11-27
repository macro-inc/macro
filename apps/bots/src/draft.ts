import type { ComputerSize } from '@macro-inc/sdk/generated/auth';
import {
  type Autonomy,
  autonomyStops,
  type Intelligence,
  intelligenceStops,
  sizes,
} from './creator-profile';
import {
  isLook,
  isPortraitTab,
  isPreset,
  type Look,
  type PortraitTab,
  type PresetId,
  presets,
} from './presets';
import { hireIntent, returnPath } from './return-intent';

export type Draft = {
  first: string;
  last: string;
  firstEdited: boolean;
  lastEdited: boolean;
  preset: PresetId;
  look: Look;
  genderEdited: boolean;
  tab: PortraitTab;
  size: ComputerSize;
  intelligence: Intelligence;
  autonomy: Autonomy;
};

export function defaultDraft(): Draft {
  const { first, last, look } = presets.atlas;
  return {
    first,
    last,
    firstEdited: false,
    lastEdited: false,
    preset: 'atlas',
    look: { ...look },
    genderEdited: false,
    tab: 'face',
    size: 'standard',
    intelligence: 'advanced',
    autonomy: 'take-initiative',
  };
}

export function draftName(draft: Draft) {
  const name = [draft.first.trim(), draft.last.trim()]
    .filter(Boolean)
    .join(' ');
  const { first, last } = presets[draft.preset];
  return name || `${first} ${last}`;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const namePartLimit = 24;

const key = 'macro.bots.hire';
const restoredKey = 'macro.bots.hire.restored';
const lifetime = 10 * 60 * 1000;

export function storeHireDraft(
  storage: DraftStorage,
  draft: Draft,
  now = Date.now()
): string {
  const handoff = crypto.randomUUID();
  storage.setItem(
    key,
    JSON.stringify({
      handoff,
      draft,
      expiresAt: now + lifetime,
      sampleSignedIn: false,
    })
  );
  return handoff;
}

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  return (
    'first' in value &&
    typeof value.first === 'string' &&
    value.first.length <= namePartLimit &&
    'last' in value &&
    typeof value.last === 'string' &&
    value.last.length <= namePartLimit &&
    'firstEdited' in value &&
    typeof value.firstEdited === 'boolean' &&
    'lastEdited' in value &&
    typeof value.lastEdited === 'boolean' &&
    'preset' in value &&
    isPreset(value.preset) &&
    'look' in value &&
    isLook(value.look) &&
    'genderEdited' in value &&
    typeof value.genderEdited === 'boolean' &&
    'tab' in value &&
    isPortraitTab(value.tab) &&
    'size' in value &&
    sizes.some((size) => size === value.size) &&
    'intelligence' in value &&
    typeof value.intelligence === 'string' &&
    Object.hasOwn(intelligenceStops, value.intelligence) &&
    'autonomy' in value &&
    typeof value.autonomy === 'string' &&
    Object.hasOwn(autonomyStops, value.autonomy)
  );
}

type StoredDraft = {
  handoff: string;
  draft: Draft;
  expiresAt: number;
  sampleSignedIn: boolean;
};

function readDraft(
  storage: DraftStorage,
  storageKey: string
): StoredDraft | undefined {
  const stored = storage.getItem(storageKey);
  if (!stored) return;

  try {
    const value: unknown = JSON.parse(stored);
    if (
      value &&
      typeof value === 'object' &&
      'handoff' in value &&
      typeof value.handoff === 'string' &&
      'expiresAt' in value &&
      typeof value.expiresAt === 'number' &&
      Number.isFinite(value.expiresAt) &&
      'sampleSignedIn' in value &&
      typeof value.sampleSignedIn === 'boolean' &&
      'draft' in value &&
      isDraft(value.draft)
    ) {
      return {
        handoff: value.handoff,
        expiresAt: value.expiresAt,
        sampleSignedIn: value.sampleSignedIn,
        draft: value.draft,
      };
    }
  } catch {
    // Ignore malformed browser storage from other versions.
  }

  storage.removeItem(storageKey);
}

export function markFixtureHireSignIn(
  storage: DraftStorage,
  handoff: string,
  now = Date.now()
): boolean {
  const stored = readDraft(storage, key);
  if (stored?.handoff !== handoff || stored.expiresAt <= now) return false;

  storage.setItem(key, JSON.stringify({ ...stored, sampleSignedIn: true }));
  return true;
}

export function takeHireDraft(
  storage: DraftStorage,
  handoff: string,
  now = Date.now()
): StoredDraft | undefined {
  const stored = readDraft(storage, key);
  if (stored?.handoff !== handoff) return;

  storage.removeItem(key);
  if (stored.expiresAt <= now) return;

  return stored;
}

export function saveRestoredHireDraft(
  storage: DraftStorage,
  restored: StoredDraft
) {
  storage.setItem(restoredKey, JSON.stringify(restored));
}

export function readRestoredHireDraft(storage: DraftStorage, now = Date.now()) {
  const restored = readDraft(storage, restoredKey);
  if (restored && restored.expiresAt > now) return restored;

  storage.removeItem(restoredKey);
}

export function clearRestoredHireDraft(storage: DraftStorage) {
  storage.removeItem(restoredKey);
}

export function hireReturnUrl(handoff: string): string {
  return `${returnPath(hireIntent)}&${new URLSearchParams({ handoff })}`;
}
