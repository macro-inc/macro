import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { DEFAULT_THEMES } from '../constants/themeConstants';
import IconLightDark from '../icons/theme-lightdark.svg';
import IconRandom from '../icons/theme-random.svg';
import IconSave from '../icons/theme-save.svg';
import IconTrash from '../icons/theme-trash.svg';
import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import {
  copyThemeToClipboard,
  deleteTheme,
  invertTheme,
  saveTheme,
} from '../utils/themeUtils';
import { randomizeTheme } from './ThemeEditorBasic';

export function ThemeTools() {
  let themeName!: HTMLDivElement;

  const currentThemeName = createMemo(() => {
    const theme = themes().find((theme) => theme.id === currentThemeId());
    if (isThemeSaved()) {
      return theme?.name;
    } else {
      return 'Untitled';
    }
  });

  const [showTrash, setShowTrash] = createSignal<boolean>(true);
  createEffect(() => {
    if (
      isThemeSaved() &&
      !DEFAULT_THEMES.find((t) => t.id === currentThemeId())
    ) {
      setShowTrash(true);
    } else {
      setShowTrash(false);
    }
  });

  return (
    <div
      style={{
        'grid-template-columns': `min-content 1fr min-content`,
        'scrollbar-width': 'none',
        'align-items': 'center',
        overflow: 'hidden',
        'flex-shrink': '0',
        display: 'grid',
        height: '22px',
        width: '100%',
        gap: '20px',
      }}
    >
      <div
        style="
          display: grid;
          grid-auto-flow: column;
          gap: 4px;
        "
      >
        <IconRandom
          onPointerDown={randomizeTheme}
          style="
            display: block;
            height: 20px;
            width: 20px;
          "
        />

        <IconLightDark
          onPointerDown={invertTheme}
          style="
            display: block;
            height: 20px;
            width: 20px;
          "
        />

        <IconLightDark
          onPointerDown={() => {
            copyThemeToClipboard(themeName.innerText);
          }}
          style="
            display: block;
            height: 20px;
            width: 20px;
          "
        />

        <Show when={!isThemeSaved()}>
          <IconSave
            onPointerDown={() => {
              saveTheme(themeName.innerText);
            }}
            style="
              display: block;
              height: 20px;
              width: 20px;
            "
          />
        </Show>

        <Show when={showTrash()}>
          <IconTrash
            onPointerDown={() => {
              deleteTheme(currentThemeId());
            }}
            style="
              display: block;
              height: 20px;
              width: 20px;
            "
          />
        </Show>
      </div>

      <hr
        style="
          border: none;
          border-top: 1px dashed var(--c4);
          box-sizing: border-box;
          width: 100%;
        "
      />

      <div
        ref={themeName}
        style="
          text-decoration: none;
          white-space: nowrap;
          outline: none;
        "
        contentEditable
      >
        {currentThemeName()}
      </div>
    </div>
  );
}
