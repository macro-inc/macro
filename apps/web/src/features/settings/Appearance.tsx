import { TabsInset } from '@core/component/TabsInset';
import { toast } from '@core/component/Toast/Toast';
import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import ClipboardIcon from '@phosphor/clipboard.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import { ThemeChipPill } from '@theme/components/ThemeChipPill';
import { ThemeChips } from '@theme/components/ThemeChips';
import { ThemeEditor } from '@theme/components/ThemeEditor';
import { DEFAULT_THEMES } from '@theme/constants';
import {
  currentThemeId,
  darkModeTheme,
  lightModeTheme,
  setDarkModeTheme,
  setIsThemeSaved,
  setLightModeTheme,
  setThemeMode,
  type ThemeMode,
  themeMode,
  themes,
  userThemes,
} from '@theme/signals/themeSignals';
import type { ThemeV2 } from '@theme/types/themeTypes';
import {
  applyTheme,
  clearThemePreview,
  deleteTheme,
  exportTheme,
  getLiveTheme,
  isTokensDark,
  previewTheme,
  resolveActiveThemeId,
  saveTheme,
  updateTheme,
} from '@theme/utils/themeUtils';
import { Dropdown, Layer, ToggleSwitch } from '@ui';
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
      <EditThemeButton name={props.name} onEdit={props.onEdit} />
      <CopyThemeButton themeId={props.themeId} name={props.name} />
    </span>
  );
}

/**
 * One per-mode theme picker row (Light or Dark): a full theme picker filtered to
 * this mode's themes, with copy/edit/delete affordances and a "New theme"
 * action, plus its own inline theme editor that opens beneath the row. Picking a
 * theme sets this mode's stored theme; if the mode is currently active, the
 * change applies live via systemThemeEffect.
 */
function ThemeSelectorRow(props: {
  label: string;
  description?: string;
  value: () => string;
  onSelect: (id: string) => void;
  filter: (theme: ThemeV2) => boolean;
}) {
  const [editorOpen, setEditorOpen] = createSignal(false);
  // The custom theme being edited (saving writes back to it); undefined for a
  // brand-new theme.
  const [editingThemeId, setEditingThemeId] = createSignal<string | undefined>(
    undefined
  );
  // The editable name of the theme being edited.
  const [themeName, setThemeName] = createSignal('New Theme');

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingThemeId(undefined);
  };

  // Abandon any in-progress edits: resync the live tokens with the active theme
  // (via resolveActiveThemeId) so a draft/preview doesn't linger, then close.
  // Shared by every edit-abandoning exit — the pill's edit toggle, the editor's
  // close button, and picking a different theme.
  const discardAndCloseEditor = () => {
    applyTheme(resolveActiveThemeId());
    closeEditor();
  };

  const chooseTheme = (id: string) => {
    props.onSelect(id);
    // Resync with the (now possibly newly-selected) active theme rather than
    // leaving the dropdown's draft/preview tokens applied, then close.
    discardAndCloseEditor();
  };

  const startNewTheme = () => {
    // Seed the new theme from the current live tokens (already shown in the
    // editor); mark it unsaved so the editor treats it as a new, nameable theme.
    // Revert any hover preview first so it doesn't become the starting point.
    clearThemePreview();
    setEditingThemeId(undefined);
    setIsThemeSaved(false);
    setThemeName('New Theme');
    setEditorOpen(true);
  };

  // Edit a theme: apply it (so the editor shows it live), then open the editor.
  // Custom themes bind to their id so saving updates them in place; default
  // themes can't be edited in place, so the editor opens as a new (forked) theme
  // seeded from the default's now-live tokens.
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
    setEditorOpen(true);
  };

  // Save the live theme: update the bound custom theme in place, or create a new
  // one, point this mode at it, and keep editing it.
  const saveCurrentTheme = () => {
    const name = themeName().trim() || 'New Theme';
    const editing = editingThemeId();
    if (editing) {
      updateTheme(editing, name);
    } else {
      saveTheme(name);
      const newId = currentThemeId();
      setEditingThemeId(newId);
      props.onSelect(newId);
    }
    toast.success('Theme saved');
  };

  const deleteThemeById = (theme: ThemeV2) => {
    // The delete button sits inside the theme's (hovered, so previewed) row and
    // closes the dropdown programmatically, which skips onOpenChange — revert
    // the preview here so the deleted theme's colors don't linger.
    clearThemePreview();
    deleteTheme(theme.id);
    // If the editor was open on the deleted theme, close it.
    if (editingThemeId() === theme.id) closeEditor();
  };

  return (
    <>
      <SettingsRow label={props.label} description={props.description}>
        <InterfaceThemeSelect
          value={props.value}
          filter={props.filter}
          onPick={chooseTheme}
          onEdit={editTheme}
          onDelete={deleteThemeById}
          onNewTheme={startNewTheme}
          editorOpen={editorOpen}
          onCloseEditor={discardAndCloseEditor}
        />
      </SettingsRow>

      {/* The theme editor opens inline beneath its selector; it mounts fresh
          each time (resetting to the Basic tab). */}
      <Show when={editorOpen()}>
        <ThemeEditor
          name={themeName()}
          onNameChange={setThemeName}
          onClose={discardAndCloseEditor}
          onSave={saveCurrentTheme}
        />
      </Show>
    </>
  );
}

/**
 * The "Interface theme" picker: a swatch-chip trigger opening a filterable,
 * scrollable dropdown of Default then Custom themes, plus a "New theme" action.
 */
function InterfaceThemeSelect(props: {
  value: () => string;
  onPick: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (theme: ThemeV2) => void;
  onNewTheme: () => void;
  // Restricts the listed themes to this mode's themes (light or dark). The
  // selected value's swatch is always shown, even if it falls outside the filter.
  filter?: (theme: ThemeV2) => boolean;
  // Whether this selector's inline editor is open — makes the pill's edit button
  // a toggle that scraps edits and closes via onCloseEditor.
  editorOpen?: () => boolean;
  onCloseEditor?: () => void;
}) {
  const [filter, setFilter] = createSignal('');
  const [open, setOpen] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const current = () => themes().find((theme) => theme.id === props.value());
  const matches = (theme: ThemeV2) =>
    (props.filter?.(theme) ?? true) &&
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
      onFocus={() => previewTheme(theme.id)}
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
      <Dropdown
        open={open()}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          // Closing without picking reverts the preview; a pick commits via
          // applyTheme first, which makes this a no-op.
          if (!isOpen) clearThemePreview();
        }}
      >
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
          onMouseLeave={clearThemePreview}
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
                // Keep typing in the box rather than triggering menu typeahead.
                // Arrow into the results explicitly; item focus then drives
                // both Kobalte's keyboard navigation and the theme preview.
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  const items = Array.from(
                    e.currentTarget
                      .closest('[role="menu"]')
                      ?.querySelectorAll<HTMLElement>(
                        '[role="menuitem"]:not([data-disabled])'
                      ) ?? []
                  );
                  const item = e.key === 'ArrowDown' ? items[0] : items.at(-1);
                  item?.focus();
                }}
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
              <Dropdown.Item
                class="touch:min-h-10"
                onSelect={props.onNewTheme}
                onFocus={clearThemePreview}
              >
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
          themeId={props.value()}
          name={current()?.name ?? 'Theme'}
          onEdit={() =>
            props.editorOpen?.()
              ? props.onCloseEditor?.()
              : props.onEdit(props.value())
          }
        />
      </Show>
    </div>
  );
}

export function Appearance() {
  return (
    // Soften any stray `b4` edge in the theme editor to the muted `b3` tone.
    <div class="h-full" style={{ '--b4l': 'var(--b3l)' }}>
      <SettingsPage title="Appearance">
        <SettingsSection title="Color Theme">
          <SettingsCard>
            {/* Active theme: pin a light or dark theme, or follow the OS. */}
            <SettingsRow
              label="Active theme"
              description="Use a light theme, a dark theme, or follow your system."
            >
              <TabsInset
                depth={2}
                onChange={(value) => setThemeMode(value as ThemeMode)}
                list={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
                value={themeMode()}
                defaultValue={themeMode()}
              />
            </SettingsRow>

            {/* Each selector chooses its mode's theme and hosts its own inline
                editor; the pick applies live when that mode is active. */}
            <ThemeSelectorRow
              label="Light theme"
              description="Used when Active theme is Light, or your system is light."
              value={lightModeTheme}
              onSelect={setLightModeTheme}
              filter={(theme) => !isTokensDark(theme.tokens)}
            />
            <ThemeSelectorRow
              label="Dark theme"
              description="Used when Active theme is Dark, or your system is dark."
              value={darkModeTheme}
              onSelect={setDarkModeTheme}
              filter={(theme) => isTokensDark(theme.tokens)}
            />
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
