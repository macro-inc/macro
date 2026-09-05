import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { toast } from '@core/component/Toast/Toast';
import type { CollectionNode } from '@kobalte/core';
import { Select } from '@kobalte/core/select';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import ClipboardIcon from '@phosphor/clipboard.svg';
import { Button, Layer } from '@ui';
import { createEffect, createSignal, onMount } from 'solid-js';
import { DEFAULT_THEMES } from '../constants';
import {
  currentThemeId,
  liveThemeMode,
  setIsThemeSaved,
  setLiveThemeMode,
  themeColorTokens,
} from '../signals/themeSignals';
import { paletteTokens, type ThemeV3 } from '../types/themeTypes';
import { setLiveThemeColorTokens } from '../utils/themeUtils';
import { isThemeV3 } from '../utils/themeValidation';
import { ThemeTokenEditor } from './ThemeTokenEditor';

type SystemTheme = (typeof DEFAULT_THEMES)[number];
type StoredDraft = {
  sourceThemeId: string;
  paletteVersion: number;
  theme: ThemeV3;
};

const THEME_EDIT_3_DRAFT_KEY = 'macro-theme-edit-3-draft';
const FIXED_PALETTE_VERSION = 1;

function readStoredDraft(): StoredDraft | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const value = localStorage.getItem(THEME_EDIT_3_DRAFT_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.sourceThemeId !== 'string') return null;
    if (!isThemeV3(candidate.theme)) return null;
    return {
      sourceThemeId: candidate.sourceThemeId,
      paletteVersion:
        typeof candidate.paletteVersion === 'number'
          ? candidate.paletteVersion
          : 0,
      theme: candidate.theme,
    };
  } catch {
    return null;
  }
}

function initialSystemTheme(): SystemTheme {
  return (
    DEFAULT_THEMES.find((theme) => theme.id === currentThemeId()) ??
    DEFAULT_THEMES[0]
  );
}

/** Local V3 theme workbench. Edits are rendered immediately but are not saved. */
export default function ThemeEdit3() {
  const initial = initialSystemTheme();
  const [selectedTheme, setSelectedTheme] = createSignal(initial);
  const [name, setName] = createSignal(`${initial.name} custom`);
  const [draftId, setDraftId] = createSignal(`${initial.id}-custom`);
  const [storageHydrated, setStorageHydrated] = createSignal(false);

  const loadSystemTheme = (theme: SystemTheme) => {
    setSelectedTheme(theme);
    setName(`${theme.name} custom`);
    setDraftId(`${theme.id}-custom`);
    setLiveThemeMode(theme.mode);
    setLiveThemeColorTokens({ ...theme.colorTokens });
    setIsThemeSaved(false);
  };

  // Restore the local workbench without changing the user's selected app
  // theme. If the source was removed, start from the current system theme.
  onMount(() => {
    const stored = readStoredDraft();
    const source = stored
      ? DEFAULT_THEMES.find((theme) => theme.id === stored.sourceThemeId)
      : undefined;

    if (stored && source) {
      const restoredTokens = {
        ...source.colorTokens,
        ...stored.theme.colorTokens,
      };
      if (stored.paletteVersion !== FIXED_PALETTE_VERSION) {
        for (const token of paletteTokens) {
          restoredTokens[token] = source.colorTokens[token];
        }
      }

      setSelectedTheme(source);
      setName(stored.theme.name);
      setDraftId(stored.theme.id);
      setLiveThemeMode(stored.theme.mode);
      setLiveThemeColorTokens(restoredTokens);
      setIsThemeSaved(false);
    } else {
      loadSystemTheme(initial);
    }
    setStorageHydrated(true);
  });

  createEffect(() => {
    if (!storageHydrated() || typeof localStorage === 'undefined') return;

    const stored: StoredDraft = {
      sourceThemeId: selectedTheme().id,
      paletteVersion: FIXED_PALETTE_VERSION,
      theme: {
        id: draftId(),
        name: name(),
        version: 3,
        mode: liveThemeMode(),
        colorTokens: { ...themeColorTokens() },
      },
    };

    try {
      localStorage.setItem(THEME_EDIT_3_DRAFT_KEY, JSON.stringify(stored));
    } catch {
      // The editor remains fully usable when storage is unavailable or full.
    }
  });

  const copyTheme = async () => {
    const theme: ThemeV3 = {
      id: draftId(),
      name: name().trim() || 'Custom theme',
      version: 3,
      mode: liveThemeMode(),
      colorTokens: { ...themeColorTokens() },
    };
    await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
    toast.success('Full theme JSON copied to clipboard');
  };

  return (
    <div class="size-full overflow-auto text-ink">
      <SplitHeaderLeft>
        <StaticSplitLabel label="Theme editor V3" />
      </SplitHeaderLeft>

      <div class="sticky top-0 z-10 border-b border-edge-muted bg-panel px-6 py-4 backdrop-blur-xl">
        <div class="flex w-full flex-wrap items-center gap-3">
          <Select<SystemTheme>
            options={DEFAULT_THEMES}
            value={selectedTheme()}
            onChange={(theme) => theme && loadSystemTheme(theme)}
            optionValue="id"
            optionTextValue="name"
            gutter={6}
            itemComponent={(itemProps: {
              item: CollectionNode<SystemTheme>;
            }) => (
              <Select.Item
                item={itemProps.item}
                class="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-ink outline-none data-highlighted:bg-hover"
              >
                <span
                  class="size-4 rounded-full border border-edge-muted"
                  style={{
                    'background-color':
                      itemProps.item.rawValue.colorTokens.accent,
                  }}
                />
                <Select.ItemLabel class="min-w-0 flex-1 truncate">
                  {itemProps.item.rawValue.name}
                </Select.ItemLabel>
                <span class="text-[10px] uppercase text-ink-extra-muted">
                  {itemProps.item.rawValue.mode}
                </span>
                <Select.ItemIndicator>
                  <CheckIcon class="size-3.5" />
                </Select.ItemIndicator>
              </Select.Item>
            )}
          >
            <Select.Trigger class="flex h-9 min-w-52 items-center gap-2 rounded-md border border-edge-muted bg-surface px-3 text-left text-sm outline-none hover:bg-hover data-expanded:bg-active">
              <span
                class="size-4 rounded-full border border-edge-muted"
                style={{
                  'background-color': selectedTheme().colorTokens.accent,
                }}
              />
              <Select.Value<SystemTheme>>
                {(state) => (
                  <span class="min-w-0 flex-1 truncate">
                    {state.selectedOption().name}
                  </span>
                )}
              </Select.Value>
              <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
            </Select.Trigger>
            <Select.Portal>
              <Layer depth={3}>
                <Select.Content class="z-action-menu min-w-60 rounded-md border border-edge-muted bg-surface p-1 shadow-lg">
                  <Select.Listbox />
                </Select.Content>
              </Layer>
            </Select.Portal>
          </Select>

          <input
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            aria-label="Theme name"
            spellcheck={false}
            class="h-9 min-w-48 flex-1 rounded-md border border-edge-muted bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
          />

          <Button variant="outline" size="md" onClick={copyTheme}>
            <ClipboardIcon class="size-4" />
            Copy full theme JSON
          </Button>
        </div>
      </div>

      <main class="mx-auto max-w-6xl px-6 py-8">
        <div class="mb-5">
          <h2 class="text-base font-medium">Color tokens</h2>
          <p class="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
            Pick a color to make it custom, or compose it from another raw token
            with link, mix, and alpha controls. Every change updates the active
            CSS variables immediately.
          </p>
        </div>
        <ThemeTokenEditor />
      </main>
    </div>
  );
}
