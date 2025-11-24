import { deleteTheme, exportTheme, invertTheme, saveTheme } from '../utils/themeUtils';
import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import IconLightDark from '@macro-icons/macro-light-dark.svg';
import IconClipboard from '@macro-icons/macro-clipboard.svg';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { IconButton } from '@core/component/IconButton';
// import IconFigma from '@macro-icons/macro-figma.svg';
import IconTrash from '@macro-icons/macro-trash.svg';
import { randomizeTheme } from './ThemeEditorBasic';
import IconDice from '@macro-icons/macro-dice.svg';
import IconSave from '@macro-icons/macro-save.svg';
// import { copyTokens } from './ComputeTokens';
import { DEFAULT_THEMES } from '../constants';

export function ThemeTools() {
  let themeName!: HTMLDivElement;

  const currentThemeName = createMemo(() => {
    const theme = themes().find((theme) => theme.id === currentThemeId());
    if(isThemeSaved()){return theme?.name}
    else{return 'Theme Name'}
  });

  const [showTrash, setShowTrash] = createSignal<boolean>(true);
  createEffect(() => {
    if(isThemeSaved() && !DEFAULT_THEMES.find((t) => t.id === currentThemeId())){setShowTrash(true)}
    else{setShowTrash(false)}
  });

  const [columnCount, setColumnCount] = createSignal(0);
  createEffect(() => {
    let count = 3;
    if(!isThemeSaved()){count++}
    if(DEV_MODE_ENV){count++}
    if(showTrash()){count++}
    setColumnCount(count);
  });

  return (
    <div
      style={{
        'grid-template-columns': `min-content 1fr repeat(${columnCount()}, min-content)`,
        'padding': '0 12px 0 20px' /* (41 - 32) / 2 */,
        'gap': '4.5px' /* (41 - 32) / 2 */,
        'font-family': 'var( --font-mono)',
        'border': '1px solid var(--b4)',
        'scrollbar-width': 'none',
        'align-items': 'center',
        'overflow': 'hidden',
        'font-size': '14px',
        'display': 'grid',
        'height': '43px',
        'width': '100%',
      }}
    >
      <div ref={themeName} contentEditable style="white-space: nowrap;">
        {currentThemeName()}
      </div>

      <hr
        style="
          border: none;
          border-top: 1px dashed var(--b4);
          box-sizing: border-box;
          width: 100%;
        "
      />

      <Show when={showTrash()}>
        <IconButton
          onPointerDown={() => {
            deleteTheme(currentThemeId());
          }}
          // tooltip={{label: "Delete Theme"}}
          icon={IconTrash}
          theme="base"
          size="sm"
        />
      </Show>

      <Show when={!isThemeSaved()}>
        <IconButton
          onPointerDown={() => {
            saveTheme(themeName.innerText);
          }}
          // tooltip={{label: "Save Theme"}}
          icon={IconSave}
          theme="base"
          size="sm"
        />
      </Show>

      {/*<Show when={DEV_MODE_ENV}>
        <IconButton
          tooltip={{label: "Copy Tokens"}}
          onPointerDown={copyTokens}
          icon={IconFigma}
          theme="base"
          size="sm"
        />
      </Show>*/}

      <Show when={DEV_MODE_ENV}>
        <IconButton
          // tooltip={{label: "Copy To Clipboard"}}
          onPointerDown={exportTheme}
          icon={IconClipboard}
          theme="base"
          size="sm"
        />
      </Show>

      <IconButton
        // tooltip={{label: "Toggle Light / Dark"}}
        onPointerDown={invertTheme}
        icon={IconLightDark}
        theme="base"
        size="sm"
      />

      <IconButton
        // tooltip={{label: "Randomize Theme"}}
        onPointerDown={randomizeTheme}
        icon={IconDice}
        theme="base"
        size="sm"
      />
    </div>
  );
}

export default ThemeTools;
