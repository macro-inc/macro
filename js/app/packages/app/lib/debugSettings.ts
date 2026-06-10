import { type Accessor, createSignal } from 'solid-js';

/**
 * Local, client-only debug settings for internal staff.
 *
 * Unlike PostHog feature flags (which are evaluated per-user via rollout),
 * these are simple booleans an admin toggles for their own session — surfaced
 * in the Admin settings panel and persisted to localStorage. They never touch
 * PostHog; a setting defaults to `false` when not explicitly enabled.
 */

export const DEBUG_SETTING_KEYS = {
  FORCE_EMPTY_STATES: 'force-empty-states',
} as const;

export type DebugSettingKey =
  (typeof DEBUG_SETTING_KEYS)[keyof typeof DEBUG_SETTING_KEYS];

export type DebugSettingDef = {
  key: DebugSettingKey;
  label: string;
  description: string;
};

/** Debug settings surfaced in the Admin panel. */
export const DEBUG_SETTINGS: DebugSettingDef[] = [
  {
    key: DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES,
    label: 'Force empty states',
    description:
      'Short-circuits sidebar nav views to their empty state regardless of content, for debugging empty states.',
  },
];

const STORAGE_KEY = 'macro:debug-settings';

function readPersisted(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, boolean>;
    }
  } catch {
    // ignore malformed / unavailable storage
  }
  return {};
}

function persist(settings: Record<string, boolean>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore unavailable storage
  }
}

const [settings, setSettings] = createSignal<Record<string, boolean>>(
  readPersisted()
);

/** Reactive accessor for the full debug-settings map. */
export { settings as debugSettings };

/** Reactive read of a single debug setting (defaults to `false`). */
export function getDebugSetting(key: DebugSettingKey): boolean {
  return settings()[key] ?? false;
}

/** Enable or disable a debug setting. */
export function setDebugSetting(key: DebugSettingKey, value: boolean): void {
  const next = { ...settings() };
  if (value) {
    next[key] = true;
  } else {
    delete next[key];
  }
  setSettings(next);
  persist(next);
}

/** Turn every debug setting back off. */
export function clearAllDebugSettings(): void {
  setSettings({});
  persist({});
}

/** Reactive accessor hook for a single debug setting. */
export function useDebugSetting(key: DebugSettingKey): Accessor<boolean> {
  return () => getDebugSetting(key);
}
