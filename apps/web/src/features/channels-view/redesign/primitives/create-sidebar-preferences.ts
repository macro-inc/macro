import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createComputed, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { z } from 'zod';
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  type DmFilter,
  type DmWindowLimit,
  type SidebarLens,
  type SidebarPreferences,
  type SupportChannelState,
} from '../core/sidebar-model';

const STORAGE_KEY = 'macro:channels:sidebar-redesign:v1';

const sidebarPreferencesSchema = z.object({
  version: z.literal(1).default(1),
  activeLens: z
    .enum(['browse', 'focus', 'support', 'threads'])
    .default(DEFAULT_SIDEBAR_PREFERENCES.activeLens),
  unreadOnly: z.boolean().default(DEFAULT_SIDEBAR_PREFERENCES.unreadOnly),
  hideMuted: z.boolean().default(DEFAULT_SIDEBAR_PREFERENCES.hideMuted),
  dmFilter: z
    .enum(['all', 'people', 'agents'])
    .default(DEFAULT_SIDEBAR_PREFERENCES.dmFilter),
  dmWindowLimit: z
    .union([z.literal(5), z.literal(7), z.literal(12), z.literal('all')])
    .default(DEFAULT_SIDEBAR_PREFERENCES.dmWindowLimit),
  dmExpandedAll: z.boolean().default(DEFAULT_SIDEBAR_PREFERENCES.dmExpandedAll),
  hiddenTeamSectionIds: z
    .array(z.string())
    .default(DEFAULT_SIDEBAR_PREFERENCES.hiddenTeamSectionIds),
  expandedLargeSectionIds: z
    .array(z.string())
    .default(DEFAULT_SIDEBAR_PREFERENCES.expandedLargeSectionIds),
  jevEnabled: z.boolean().default(DEFAULT_SIDEBAR_PREFERENCES.jevEnabled),
  collapsedPersonalZone: z
    .boolean()
    .default(DEFAULT_SIDEBAR_PREFERENCES.collapsedPersonalZone),
  collapsedTeamZone: z
    .boolean()
    .default(DEFAULT_SIDEBAR_PREFERENCES.collapsedTeamZone),
  collapsedSupportBuckets: z
    .array(
      z.enum([
        'urgent',
        'needs_reply',
        'agent_handling',
        'waiting_on_customer',
        'resolved',
      ])
    )
    .default(DEFAULT_SIDEBAR_PREFERENCES.collapsedSupportBuckets),
  collapsedFocusFyi: z
    .boolean()
    .default(DEFAULT_SIDEBAR_PREFERENCES.collapsedFocusFyi),
});

export type SidebarPreferencesStorage = {
  read: (userId: string) => string | null;
  write: (userId: string, value: string) => void;
};

const defaultStorage: SidebarPreferencesStorage =
  createUserScopedStorage(STORAGE_KEY);

function parsePreferences(raw: string | null): SidebarPreferences {
  if (!raw) return { ...DEFAULT_SIDEBAR_PREFERENCES };
  try {
    const parsed = sidebarPreferencesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { ...DEFAULT_SIDEBAR_PREFERENCES };
    const { version: _version, ...rest } = parsed.data;
    return rest;
  } catch {
    return { ...DEFAULT_SIDEBAR_PREFERENCES };
  }
}

export type SidebarPreferencesController = {
  prefs: SidebarPreferences;
  setActiveLens: (lens: SidebarLens) => void;
  setUnreadOnly: (unreadOnly: boolean) => void;
  toggleUnreadOnly: () => void;
  setHideMuted: (hideMuted: boolean) => void;
  toggleHideMuted: () => void;
  setDmFilter: (filter: DmFilter) => void;
  setDmWindowLimit: (limit: DmWindowLimit) => void;
  setDmExpandedAll: (expanded: boolean) => void;
  hideTeamSection: (sectionId: string) => void;
  showTeamSection: (sectionId: string) => void;
  restoreAllHiddenTeamSections: () => void;
  toggleLargeSectionExpanded: (sectionId: string) => void;
  setJevEnabled: (enabled: boolean) => void;
  togglePersonalZone: () => void;
  toggleTeamZone: () => void;
  toggleSupportBucket: (state: SupportChannelState) => void;
  toggleFocusFyi: () => void;
};

/**
 * Account-scoped personal preferences for the redesigned Chat sidebar.
 *
 * Rehydrates cleanly whenever `userId()` switches accounts so one account's
 * hidden team sections or filters never bleed into another.
 */
export function createSidebarPreferences(options: {
  userId: Accessor<string | undefined>;
  storage?: SidebarPreferencesStorage;
}): SidebarPreferencesController {
  const storage = options.storage ?? defaultStorage;
  const initialUserId = options.userId();
  const [prefs, setPrefs] = createStore<SidebarPreferences>(
    initialUserId
      ? parsePreferences(storage.read(initialUserId))
      : { ...DEFAULT_SIDEBAR_PREFERENCES }
  );

  let hydratedFor: string | undefined = initialUserId;

  const persist = () => {
    const uid = options.userId();
    if (!uid || uid !== hydratedFor) return;
    storage.write(uid, JSON.stringify({ version: 1, ...prefs }));
  };

  createComputed(
    on(
      options.userId,
      (uid) => {
        if (uid === hydratedFor) return;
        hydratedFor = uid;
        const next = uid
          ? parsePreferences(storage.read(uid))
          : { ...DEFAULT_SIDEBAR_PREFERENCES };
        setPrefs(reconcile(next));
      },
      { defer: true }
    )
  );

  const update = (mutator: () => void) => {
    mutator();
    persist();
  };

  return {
    prefs,
    setActiveLens: (lens) => update(() => setPrefs('activeLens', lens)),
    setUnreadOnly: (unreadOnly) =>
      update(() => setPrefs('unreadOnly', unreadOnly)),
    toggleUnreadOnly: () =>
      update(() => setPrefs('unreadOnly', (current) => !current)),
    setHideMuted: (hideMuted) => update(() => setPrefs('hideMuted', hideMuted)),
    toggleHideMuted: () =>
      update(() => setPrefs('hideMuted', (current) => !current)),
    setDmFilter: (filter) => update(() => setPrefs('dmFilter', filter)),
    setDmWindowLimit: (limit) =>
      update(() => {
        setPrefs('dmWindowLimit', limit);
        if (limit !== 'all') setPrefs('dmExpandedAll', false);
      }),
    setDmExpandedAll: (expanded) =>
      update(() => setPrefs('dmExpandedAll', expanded)),
    hideTeamSection: (sectionId) =>
      update(() =>
        setPrefs('hiddenTeamSectionIds', (current) =>
          current.includes(sectionId) ? current : [...current, sectionId]
        )
      ),
    showTeamSection: (sectionId) =>
      update(() =>
        setPrefs('hiddenTeamSectionIds', (current) =>
          current.filter((id) => id !== sectionId)
        )
      ),
    restoreAllHiddenTeamSections: () =>
      update(() => setPrefs('hiddenTeamSectionIds', [])),
    toggleLargeSectionExpanded: (sectionId) =>
      update(() =>
        setPrefs('expandedLargeSectionIds', (current) =>
          current.includes(sectionId)
            ? current.filter((id) => id !== sectionId)
            : [...current, sectionId]
        )
      ),
    setJevEnabled: (enabled) => update(() => setPrefs('jevEnabled', enabled)),
    togglePersonalZone: () =>
      update(() => setPrefs('collapsedPersonalZone', (current) => !current)),
    toggleTeamZone: () =>
      update(() => setPrefs('collapsedTeamZone', (current) => !current)),
    toggleSupportBucket: (state) =>
      update(() =>
        setPrefs('collapsedSupportBuckets', (current) =>
          current.includes(state)
            ? current.filter((item) => item !== state)
            : [...current, state]
        )
      ),
    toggleFocusFyi: () =>
      update(() => setPrefs('collapsedFocusFyi', (current) => !current)),
  };
}
