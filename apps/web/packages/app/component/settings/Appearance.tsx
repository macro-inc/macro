import { TabsInset } from '@core/component/TabsInset';
import { toast } from '@core/component/Toast/Toast';
import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import ClipboardIcon from '@phosphor/clipboard.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import ShuffleIcon from '@phosphor/shuffle.svg';
import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import { ThemeChipPill } from '@theme/components/ThemeChipPill';
import { ThemeChips } from '@theme/components/ThemeChips';
import { ThemeEditorAdvanced } from '@theme/components/ThemeEditorAdvanced';
import {
  randomizeTheme,
  ThemeEditorBasic,
} from '@theme/components/ThemeEditorBasic';
import { DEFAULT_THEMES } from '@theme/constants';
import {
  currentThemeId,
  darkModeTheme,
  lightModeTheme,
  setDarkModeTheme,
  setIsThemeSaved,
  setLightModeTheme,
  setThemeShouldMatchSystem,
  themeShouldMatchSystem,
  themes,
  userThemes,
} from '@theme/signals/themeSignals';
import type { ThemeV2 } from '@theme/types/themeTypes';
import {
  applyTheme,
  deleteTheme,
  exportTheme,
  getLiveTheme,
  isTokensDark,
  saveTheme,
  updateTheme,
} from '@theme/utils/themeUtils';
import { Button, cn, Dropdown, Layer, ToggleSwitch } from '@ui';
import {
  monochromeIcons,
  setMonochromeIcons,
  setTooltipsEnabled,
  tooltipsEnabled,
} from '@ui/signals/signals';
import { createSignal, For, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

type EditorTab = 'basic' | 'advanced';

/** Copies a theme's JSON to the clipboard (for sharing / importing elsewhere). */
function CopyThemeButton(props: { themeId: string; name: string }) {
  return (
    <button
      type="button"
      aria-label={`Copy ${props.name}`}
      class="rounded p-0.5 hover:text-ink mobile:p-1.5"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        exportTheme(props.themeId);
        toast.success('Theme copied to clipboard');
      }}
    >
      <ClipboardIcon class="size-3.5 mobile:size-5" />
    </button>
  );
}

/** Edits a theme in the inline editor (custom → in place, default → forked). */
function EditThemeButton(props: { name: string; onEdit: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Edit ${props.name}`}
      class="rounded p-0.5 hover:text-ink mobile:p-1.5"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onEdit();
      }}
    >
      <PencilIcon class="size-3.5 mobile:size-5" />
    </button>
  );
}

/**
 * The copy + edit affordances surfaced beside a theme pill, so the common theme
 * actions aren't buried inside the picker dropdown. Always visible (unlike the
 * hover-gated per-row actions inside the dropdown).
 */
function ThemePillActions(props: {
  themeId: string;
  name: string;
  onEdit: () => void;
}) {
  return (
    <span class="flex shrink-0 items-center gap-0.5 text-ink-extra-muted">
      <CopyThemeButton themeId={props.themeId} name={props.name} />
      <EditThemeButton name={props.name} onEdit={props.onEdit} />
    </span>
  );
}

/** A default/preferred-theme picker row, shown indented beneath auto-detect. */
function ThemePreferenceRow(props: {
  label: string;
  value: () => string;
  options: () => ThemeV2[];
  onSelect: (id: string) => void;
  // Default themes only take effect while auto-detect is on, so the control is
  // dimmed and non-interactive otherwise.
  disabled?: () => boolean;
}) {
  const selectedTheme = () =>
    themes().find((theme) => theme.id === props.value());

  return (
    <div
      class={cn(
        // Nested under the auto-detect toggle: the indent marks these as
        // sub-settings that only apply while auto-detect is on.
        'bg-surface flex items-center justify-between h-12 px-6 pl-10 transition-opacity',
        props.disabled?.() && 'opacity-50 pointer-events-none'
      )}
      aria-disabled={props.disabled?.()}
    >
      <div class="text-sm">{props.label}</div>
      <div class="flex items-center gap-1">
        <Dropdown>
          <KobalteDropdownMenu.Trigger
            as={ThemeChipPill}
            class="h-auto text-xs rounded-lg border border-edge-muted py-1 pl-1 pr-2 hover:bg-ink/4"
            disabled={props.disabled?.()}
            theme={selectedTheme()}
            name={selectedTheme()?.name ?? props.value()}
          />
          <Dropdown.Content
            as="div"
            class="overflow-hidden border border-ink/[0.05] bg-surface shadow-menu"
          >
            <Layer depth={3}>
              <Dropdown.Group>
                <For each={props.options()}>
                  {(theme) => (
                    <Dropdown.Item
                      class="group touch:min-h-10"
                      onSelect={() => props.onSelect(theme.id)}
                    >
                      <span class="flex min-w-0 flex-1 items-center gap-2">
                        <ThemeChips theme={theme} size="sm" />
                        <span class="truncate">{theme.name}</span>
                      </span>
                      <span class="ml-2 shrink-0 text-ink-extra-muted opacity-0 group-hover:opacity-100 touch:opacity-100">
                        <CopyThemeButton themeId={theme.id} name={theme.name} />
                      </span>
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Layer>
          </Dropdown.Content>
        </Dropdown>
        {/* Default rows expose copy only — editing a per-mode default happens
            from the main Interface theme picker. */}
        <span class="flex shrink-0 items-center text-ink-extra-muted">
          <CopyThemeButton
            themeId={props.value()}
            name={selectedTheme()?.name ?? props.value()}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * The "Interface theme" picker: a swatch-chip trigger opening a filterable,
 * scrollable dropdown of Default then Custom themes, plus a "New theme" action.
 */
function InterfaceThemeSelect(props: {
  onPick: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (theme: ThemeV2) => void;
  onNewTheme: () => void;
}) {
  const [filter, setFilter] = createSignal('');
  const [open, setOpen] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const current = () => themes().find((theme) => theme.id === currentThemeId());
  const matches = (theme: ThemeV2) =>
    theme.name.toLowerCase().includes(filter().trim().toLowerCase());
  const defaults = () =>
    (DEFAULT_THEMES as unknown as ThemeV2[]).filter(matches);
  const customs = () => userThemes().filter(matches);

  // `editable` custom themes get an inline edit affordance that opens the
  // editor for that theme (saving writes back to it).
  const themeItem = (theme: ThemeV2, editable?: boolean) => (
    <Dropdown.Item
      class="group touch:min-h-10"
      onSelect={() => props.onPick(theme.id)}
    >
      <span class="flex min-w-0 flex-1 items-center gap-2">
        <ThemeChips theme={theme} size="sm" />
        <span class="truncate">{theme.name}</span>
      </span>
      <span class="ml-2 flex shrink-0 items-center gap-0.5 text-ink-extra-muted opacity-0 group-hover:opacity-100 touch:opacity-100">
        <CopyThemeButton themeId={theme.id} name={theme.name} />
        <Show when={editable}>
          <button
            type="button"
            aria-label={`Edit ${theme.name}`}
            class="rounded p-0.5 hover:text-ink"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              props.onEdit(theme.id);
            }}
          >
            <PencilIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${theme.name}`}
            class="rounded p-0.5 hover:text-failure"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              props.onDelete(theme);
            }}
          >
            <TrashIcon class="size-3.5" />
          </button>
        </Show>
      </span>
    </Dropdown.Item>
  );

  return (
    <div class="flex items-center gap-1">
      <Dropdown open={open()} onOpenChange={setOpen}>
        <KobalteDropdownMenu.Trigger
          as={ThemeChipPill}
          class="h-auto text-xs rounded-lg border border-edge-muted py-1 pl-1 pr-2 hover:bg-ink/4"
          // With no stored theme selected (e.g. the active theme was just
          // deleted), fall back to the live tokens so the swatch still reflects
          // the current colors and the label reads "Unsaved Theme".
          theme={current() ?? getLiveTheme()}
          name={current()?.name ?? 'Unsaved Theme'}
        />
        <Dropdown.Content
          // Render as a plain div (not Surface) so the edge is a faint ink
          // hairline like the settings cards, rather than the heavier b4 border.
          as="div"
          class="w-60 overflow-hidden border border-ink/[0.05] bg-surface shadow-menu"
          onOpenAutoFocus={(e: Event) => {
            // Focus the filter input instead of the first item.
            e.preventDefault();
            inputRef?.focus();
          }}
          onCloseAutoFocus={() => setFilter('')}
        >
          {/* Elevate the menu's fill a level so it reads distinct from the
            settings cards, while the outer Surface keeps its subtle edges. */}
          <Layer depth={3}>
            <div class="bg-surface p-1.5">
              <input
                ref={inputRef}
                type="text"
                value={filter()}
                onInput={(e) => setFilter(e.currentTarget.value)}
                // Keep typing in the box rather than triggering the menu's typeahead.
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Filter themes…"
                spellcheck={false}
                class="h-8 w-full rounded-md border border-edge-muted bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-ink-extra-muted focus:border-accent"
              />
            </div>

            <div class="max-h-64 overflow-y-auto bg-surface">
              <Show when={defaults().length > 0}>
                <Dropdown.Group>
                  <Dropdown.GroupLabel>Default</Dropdown.GroupLabel>
                  <For each={defaults()}>{(theme) => themeItem(theme)}</For>
                </Dropdown.Group>
              </Show>
              <Show when={customs().length > 0}>
                <Dropdown.Group>
                  <Dropdown.GroupLabel>Custom</Dropdown.GroupLabel>
                  <For each={customs()}>
                    {(theme) => themeItem(theme, true)}
                  </For>
                </Dropdown.Group>
              </Show>
              <Show when={defaults().length === 0 && customs().length === 0}>
                <div class="px-3 py-4 text-center text-xs text-ink-muted">
                  No themes match “{filter()}”
                </div>
              </Show>
            </div>

            <Dropdown.Group>
              <Dropdown.Item class="touch:min-h-10" onSelect={props.onNewTheme}>
                <span class="flex items-center gap-2 text-ink-muted">
                  <PlusIcon class="size-4" />
                  New theme
                </span>
              </Dropdown.Item>
            </Dropdown.Group>
          </Layer>
        </Dropdown.Content>
      </Dropdown>
      <Show when={current()}>
        <ThemePillActions
          themeId={currentThemeId()}
          name={current()?.name ?? 'Theme'}
          onEdit={() => props.onEdit(currentThemeId())}
        />
      </Show>
    </div>
  );
}

export function Appearance() {
  const [editorTab, setEditorTab] = createSignal<EditorTab>('basic');
  const [editorOpen, setEditorOpen] = createSignal(false);
  // The custom theme being edited (saving writes back to it); undefined for a
  // brand-new theme.
  const [editingThemeId, setEditingThemeId] = createSignal<string | undefined>(
    undefined
  );
  // The editable name of the theme being edited.
  const [themeName, setThemeName] = createSignal('New Theme');

  const lightThemes = () =>
    themes().filter((theme) => !isTokensDark(theme.tokens));
  const darkThemes = () =>
    themes().filter((theme) => isTokensDark(theme.tokens));

  const chooseTheme = (id: string) => {
    applyTheme(id);
    setEditingThemeId(undefined);
    setEditorOpen(false);
  };

  const startNewTheme = () => {
    // Initialize the new theme from the current theme's variables (already live
    // in the editor); mark it unsaved so the editor treats it as a new, nameable
    // theme rather than the saved one it was copied from.
    setEditingThemeId(undefined);
    setIsThemeSaved(false);
    setThemeName('New Theme');
    setEditorTab('basic');
    setEditorOpen(true);
  };

  // Edit a theme: apply it, then open the inline editor. Custom themes bind to
  // their id so saving updates them in place; default themes can't be edited in
  // place, so the editor opens as a new (forked) theme seeded from the default's
  // now-live tokens.
  const editTheme = (id: string) => {
    applyTheme(id);
    const source = themes().find((t) => t.id === id);
    const isCustom = userThemes().some((t) => t.id === id);
    if (isCustom) {
      setEditingThemeId(id);
      setThemeName(source?.name ?? 'Theme');
    } else {
      setEditingThemeId(undefined);
      setIsThemeSaved(false);
      setThemeName(`${source?.name ?? 'Theme'} copy`);
    }
    setEditorTab('basic');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingThemeId(undefined);
  };

  // Save the live theme: update the bound custom theme in place, or create a
  // new one (then keep editing it).
  const saveCurrentTheme = () => {
    const name = themeName().trim() || 'New Theme';
    const editing = editingThemeId();
    if (editing) {
      updateTheme(editing, name);
    } else {
      saveTheme(name);
      setEditingThemeId(currentThemeId());
    }
    toast.success('Theme saved');
  };

  const deleteThemeById = (theme: ThemeV2) => {
    deleteTheme(theme.id);
    // If the editor was open on the deleted theme, close it.
    if (editingThemeId() === theme.id) closeEditor();
  };

  return (
    // Soften any stray `b4` edge in the theme editor to the muted `b3` tone.
    <div class="h-full" style={{ '--b4l': 'var(--b3l)' }}>
      <SettingsPage title="Appearance">
        <SettingsSection title="Color Theme">
          <SettingsCard>
            <SettingsRow
              label="Interface theme"
              description="The color theme used across the app."
            >
              <InterfaceThemeSelect
                onPick={chooseTheme}
                onEdit={editTheme}
                onDelete={deleteThemeById}
                onNewTheme={startNewTheme}
              />
            </SettingsRow>

            {/* The theme editor opens inline beneath "Interface theme" as a
                distinct active-editing block: a neutral, slightly elevated
                surface (one step lighter than the card via Layer depth), inset +
                rounded so it reads as a nested element. No color-forward accent. */}
            <Show when={editorOpen()}>
              <Layer depth={3}>
                <div class="mx-3 my-2 flex flex-col gap-3 rounded-xl border border-ink/[0.05] bg-surface px-4 py-4">
                  <div class="flex items-center gap-2">
                    <Button
                      label="Close editor"
                      onClick={closeEditor}
                      variant="ghost"
                      size="icon-sm"
                    >
                      <XIcon class="size-4" />
                    </Button>
                    <input
                      type="text"
                      value={themeName()}
                      onInput={(e) => setThemeName(e.currentTarget.value)}
                      spellcheck={false}
                      placeholder="Theme name"
                      aria-label="Theme name"
                      class="w-40 min-w-0 rounded-md border border-edge-muted bg-transparent px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-extra-muted focus:border-accent"
                    />
                    <div class="flex-1" />
                    <Button
                      label="Randomize theme"
                      onPointerDown={randomizeTheme}
                      variant="ghost"
                      size="icon-sm"
                    >
                      <ShuffleIcon class="size-4" />
                    </Button>
                    <TabsInset
                      depth={3}
                      onChange={(value) => setEditorTab(value as EditorTab)}
                      list={[
                        { value: 'basic', label: 'Basic' },
                        { value: 'advanced', label: 'Variables' },
                      ]}
                      value={editorTab()}
                      defaultValue="basic"
                    />
                  </div>
                  <div class="relative overflow-hidden rounded-lg">
                    {/* The Basic view defines the box height; it stays mounted
                      (just hidden) on the Variables tab so the variables list
                      scrolls within that same height. Basic rows use dividers
                      only; the Variables list keeps a bordered container. */}
                    <div classList={{ invisible: editorTab() !== 'basic' }}>
                      <ThemeEditorBasic />
                    </div>
                    <Show when={editorTab() === 'advanced'}>
                      <div class="absolute inset-0 overflow-y-auto rounded-lg border border-ink/[0.05] bg-surface">
                        <ThemeEditorAdvanced />
                      </div>
                    </Show>
                  </div>
                  <div class="flex justify-end">
                    <Button variant="base" size="sm" onClick={saveCurrentTheme}>
                      Save theme
                    </Button>
                  </div>
                </div>
              </Layer>
            </Show>

            <SettingsRow
              label="Auto-detect color scheme"
              description="Switch theme with your system's light/dark mode."
            >
              <ToggleSwitch
                size="md"
                onChange={setThemeShouldMatchSystem}
                checked={themeShouldMatchSystem()}
              />
            </SettingsRow>

            {/* Sub-settings collapse away while auto-detect is off. */}
            <Show when={themeShouldMatchSystem()}>
              <ThemePreferenceRow
                label="Default light theme"
                value={lightModeTheme}
                options={lightThemes}
                onSelect={setLightModeTheme}
              />
              <ThemePreferenceRow
                label="Default dark theme"
                value={darkModeTheme}
                options={darkThemes}
                onSelect={setDarkModeTheme}
              />
            </Show>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Interface">
          <SettingsCard>
            <SettingsRow
              label="Monochrome icons"
              description="Use single-color icons across the app."
            >
              <ToggleSwitch
                size="md"
                onChange={setMonochromeIcons}
                checked={monochromeIcons()}
              />
            </SettingsRow>
            <SettingsRow
              label="Show tooltips"
              description="Show hover hints on buttons and controls."
            >
              <ToggleSwitch
                size="md"
                onChange={setTooltipsEnabled}
                checked={tooltipsEnabled()}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </SettingsPage>
    </div>
  );
}
