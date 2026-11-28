import type { ComputerSize } from '@macro-inc/sdk/generated/auth';
import {
  type Autonomy,
  autonomyChoices,
  type Intelligence,
  intelligenceChoices,
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
  /**
   * The one full display name, held exactly as typed: it is never split, re-joined or collapsed.
   * `draftName` gives the handed-off value, which drops only leading and trailing whitespace.
   */
  name: string;
  /** False until the viewer types a name; clearing the field makes it false again. */
  nameEdited: boolean;
  preset: PresetId;
  look: Look;
  genderEdited: boolean;
  tab: PortraitTab;
  size: ComputerSize;
  intelligence: Intelligence;
  autonomy: Autonomy;
};

/** The name a preset starts with. */
export function presetName(id: PresetId): string {
  const { first, last } = presets[id];
  return `${first} ${last}`;
}

export function defaultDraft(): Draft {
  return {
    name: presetName('atlas'),
    nameEdited: false,
    preset: 'atlas',
    look: { ...presets.atlas.look },
    genderEdited: false,
    tab: 'face',
    size: 'standard',
    intelligence: 'advanced',
    autonomy: 'take-initiative',
  };
}

/**
 * The name shown on the stage and handed to Hire: the typed name without leading or trailing
 * whitespace, with every inner character kept. An empty field falls back to the preset's name.
 */
export function draftName(draft: Draft) {
  return draft.name.trim() || presetName(draft.preset);
}

/**
 * Start from a preset. A typed name stays; an untouched or cleared name field takes the preset's
 * name. The same holds for a chosen gender.
 */
export function withPreset(draft: Draft, id: PresetId): Draft {
  const { look } = presets[id];
  return {
    ...draft,
    preset: id,
    name: draft.nameEdited ? draft.name : presetName(id),
    look: {
      ...look,
      gender: draft.genderEdited ? draft.look.gender : look.gender,
    },
  };
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The service accepts a trimmed display name of 1 to 64 Unicode characters. The field and stored
 * drafts are limited in UTF-16 units, which never allows more characters than that.
 */
export const nameLimit = 64;
/** Each part of a two-field draft written by an earlier version was limited to this. */
const legacyNamePartLimit = 24;

const key = 'macro.bots.hire';
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

/**
 * The name of a stored draft. A draft written by an earlier version has two parts: they become one
 * name exactly as that version displayed them, and the name counts as edited if either part was.
 */
function parseName(
  value: object
): Pick<Draft, 'name' | 'nameEdited'> | undefined {
  if (
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.length <= nameLimit &&
    'nameEdited' in value &&
    typeof value.nameEdited === 'boolean'
  ) {
    return { name: value.name, nameEdited: value.nameEdited };
  }
  if (
    'first' in value &&
    typeof value.first === 'string' &&
    value.first.length <= legacyNamePartLimit &&
    'last' in value &&
    typeof value.last === 'string' &&
    value.last.length <= legacyNamePartLimit &&
    'firstEdited' in value &&
    typeof value.firstEdited === 'boolean' &&
    'lastEdited' in value &&
    typeof value.lastEdited === 'boolean'
  ) {
    return {
      name: [value.first.trim(), value.last.trim()].filter(Boolean).join(' '),
      nameEdited: value.firstEdited || value.lastEdited,
    };
  }
}

/** A stored draft in the current shape, or undefined when the stored value is not a draft. */
export function parseDraft(value: unknown): Draft | undefined {
  if (!value || typeof value !== 'object') return;
  const name = parseName(value);
  if (
    name &&
    'preset' in value &&
    isPreset(value.preset) &&
    'look' in value &&
    isLook(value.look) &&
    'genderEdited' in value &&
    typeof value.genderEdited === 'boolean' &&
    'tab' in value &&
    isPortraitTab(value.tab) &&
    'size' in value &&
    'intelligence' in value &&
    'autonomy' in value
  ) {
    const size = sizes.find((item) => item === value.size);
    const intelligence = intelligenceChoices.find(
      (item) => item === value.intelligence
    );
    const autonomy = autonomyChoices.find((item) => item === value.autonomy);
    if (!size || !intelligence || !autonomy) return;
    return {
      ...name,
      preset: value.preset,
      look: value.look,
      genderEdited: value.genderEdited,
      tab: value.tab,
      size,
      intelligence,
      autonomy,
    };
  }
}

type StoredDraft = {
  handoff: string | null;
  draft: Draft;
  expiresAt: number;
  sampleSignedIn: boolean;
};

function readDraft(storage: DraftStorage): StoredDraft | undefined {
  const stored = storage.getItem(key);
  if (!stored) return;

  try {
    const value: unknown = JSON.parse(stored);
    if (
      value &&
      typeof value === 'object' &&
      'handoff' in value &&
      (value.handoff === null || typeof value.handoff === 'string') &&
      'expiresAt' in value &&
      typeof value.expiresAt === 'number' &&
      Number.isFinite(value.expiresAt) &&
      'sampleSignedIn' in value &&
      typeof value.sampleSignedIn === 'boolean' &&
      'draft' in value
    ) {
      const draft = parseDraft(value.draft);
      if (draft) {
        return {
          handoff: value.handoff,
          expiresAt: value.expiresAt,
          sampleSignedIn: value.sampleSignedIn,
          draft,
        };
      }
    }
  } catch {
    // Ignore malformed browser storage from other versions.
  }

  storage.removeItem(key);
}

export function markFixtureHireSignIn(
  storage: DraftStorage,
  handoff: string,
  now = Date.now()
): boolean {
  const stored = readDraft(storage);
  if (stored?.handoff !== handoff || stored.expiresAt <= now) return false;

  storage.setItem(key, JSON.stringify({ ...stored, sampleSignedIn: true }));
  return true;
}

export function takeHireDraft(
  storage: DraftStorage,
  handoff: string,
  now = Date.now()
): StoredDraft | undefined {
  const stored = readDraft(storage);
  if (stored?.handoff !== handoff) return;

  if (stored.expiresAt <= now) {
    storage.removeItem(key);
    return;
  }

  // Replace the pending record in one write. A storage failure leaves the
  // original handoff intact and the caller can retry the same return URL.
  const restored = { ...stored, handoff: null };
  storage.setItem(key, JSON.stringify(restored));
  return restored;
}

export function saveRestoredHireDraft(
  storage: DraftStorage,
  restored: StoredDraft
) {
  const current = readDraft(storage);
  if (current?.handoff === null && current.expiresAt === restored.expiresAt) {
    storage.setItem(key, JSON.stringify(restored));
  }
}

export function readRestoredHireDraft(storage: DraftStorage, now = Date.now()) {
  const restored = readDraft(storage);
  if (restored?.handoff !== null) return;
  if (restored.expiresAt > now) return restored;

  storage.removeItem(key);
}

/**
 * The draft still waiting on sign-in, read without consuming its handoff. Browser Back from sign-in
 * lands on the Creator with no return parameters; the same tab gets its exact draft back this way.
 */
export function readPendingHireDraft(storage: DraftStorage, now = Date.now()) {
  const pending = readDraft(storage);
  if (typeof pending?.handoff !== 'string') return;
  if (pending.expiresAt > now) return pending;

  storage.removeItem(key);
}

/** Keep the waiting draft current while its handoff is still the one in this tab. */
export function savePendingHireDraft(
  storage: DraftStorage,
  pending: StoredDraft,
  draft: Draft
) {
  const current = readDraft(storage);
  if (
    typeof current?.handoff === 'string' &&
    current.handoff === pending.handoff &&
    current.expiresAt === pending.expiresAt
  ) {
    storage.setItem(key, JSON.stringify({ ...current, draft }));
  }
}

export function clearRestoredHireDraft(storage: DraftStorage) {
  if (readDraft(storage)?.handoff === null) storage.removeItem(key);
}

export function hireReturnUrl(handoff: string): string {
  return `${returnPath(hireIntent)}&${new URLSearchParams({ handoff })}`;
}

const workingKey = 'macro-bots:working-draft';

/**
 * The draft being edited, kept for this tab so a reload does not lose a name or a randomized look.
 * It holds the draft and nothing else: no session, no quote, no handoff. A draft waiting on a Hire
 * handoff or restored from one always comes first; this is only read when neither exists.
 */
export function saveWorkingDraft(storage: DraftStorage, draft: Draft) {
  storage.setItem(workingKey, JSON.stringify(draft));
}

export function readWorkingDraft(storage: DraftStorage): Draft | undefined {
  const raw = storage.getItem(workingKey);
  if (raw === null) return;
  try {
    const draft = parseDraft(JSON.parse(raw));
    if (draft) return draft;
  } catch {
    // Not a draft: dropped below.
  }
  storage.removeItem(workingKey);
}

export function clearWorkingDraft(storage: DraftStorage) {
  storage.removeItem(workingKey);
}

/** True while the look is exactly what its preset gives: only then is that preset the selected one. */
export function matchesPreset(draft: Draft): boolean {
  return (
    JSON.stringify(withPreset(draft, draft.preset).look) ===
    JSON.stringify(draft.look)
  );
}
