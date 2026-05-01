import { deleteTheme, exportTheme, importTheme, invertTheme, saveTheme } from '../utils/themeUtils';
import { currentThemeId, isThemeSaved, themes, userThemes } from '../signals/themeSignals';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import IconLightDark from '@macro-icons/macro-light-dark.svg';
import IconClipboard from '@macro-icons/macro-clipboard.svg';
import IconImport from '@macro-icons/macro-import.svg';
import IconTrash from '@macro-icons/macro-trash.svg';
import { randomizeTheme } from './ThemeEditorBasic';
import IconDice from '@macro-icons/macro-dice.svg';
import IconSave from '@macro-icons/macro-save.svg';

export function ThemeTools() {
  let themeName!: HTMLDivElement;

  const defaultThemeName = 'New Theme';

  const currentThemeName = createMemo(() => {
    const theme = themes().find((theme) => theme.id === currentThemeId());
    if(isThemeSaved()){return theme?.name}
    else{return defaultThemeName}
  });

  const [showTrash, setShowTrash] = createSignal<boolean>(true);
  createEffect(() => {
    if(isThemeSaved() && userThemes().some((t) => t.id === currentThemeId())){setShowTrash(true)}
    else{setShowTrash(false)}
  });

  const [columnCount, setColumnCount] = createSignal(0);
  createEffect(() => {
    let count = 5;
    if(showTrash()){count++}
    setColumnCount(count);
  });

  return (
    <div
      style={{
        'grid-template-columns': ` min-content 1fr repeat(${columnCount()}, min-content)`,
        'padding': '0 12px 0 20px' /* (41 - 32) / 2 */,
        'border-bottom': '1px solid var(--b3)',
        'gap': '4.5px' /* (41 - 32) / 2 */,
        'font-family': 'var(--font-sans)',
        'background-color': 'var(--b0)',
        'scrollbar-width': 'none',
        'align-items': 'center',
        'overflow': 'hidden',
        'font-size': '14px',
        'height': '39.5px',
        'display': 'grid',
        'width': '100%',
      }}
    >
      <div
        onKeyDown={(e) => {
          if(e.key === 'Enter'){
            e.preventDefault();
            const name = themeName.innerText.trim();
            if(name){
              saveTheme(name);
              themeName.blur();
            }
            else { themeName.innerText = defaultThemeName; }
          }
        }}
        onBlur={() => {
          if(!themeName.innerText.trim()){
            themeName.innerText = defaultThemeName;
          }
        }}
        style={{
          'white-space': 'nowrap',
          'font-size': '0.875rem',
          'font-weight': '600',
          'outline': 'none',
        }}
        contentEditable={true}
        ref={themeName}
      >
        {currentThemeName()}
      </div>

      <div/>

      <Show when={showTrash()}>
        <DeprecatedIconButton
          onPointerDown={() => {
            deleteTheme(currentThemeId());
          }}
          tooltip={{label: "Delete Theme"}}
          icon={IconTrash}
          theme="clear"
          size="sm"
        />
      </Show>

      <Show when={!isThemeSaved()}>
        <DeprecatedIconButton
          onPointerDown={() => {
            saveTheme(themeName.innerText);
          }}
          tooltip={{label: "Save Theme"}}
          icon={IconSave}
          theme="clear"
          size="sm"
        />
      </Show>

      {/*<Show when={DEV_MODE_ENV}>
        <IconButton
          tooltip={{label: "Copy Tokens"}}
          onPointerDown={copyTokens}
          icon={IconFigma}
          theme="clear"
          size="sm"
        />
      </Show>*/}

      <Show when={isThemeSaved()}>
        <DeprecatedIconButton
          tooltip={{label: "Copy To Clipboard"}}
          onPointerDown={exportTheme}
          icon={IconClipboard}
          theme="clear"
          size="sm"
        />
      </Show>

        <DeprecatedIconButton
          tooltip={{label: "Import From Clipboard"}}
          onPointerDown={importTheme}
          icon={IconImport}
          theme="clear"
          size="sm"
        />

      <DeprecatedIconButton
        tooltip={{label: "Toggle Light / Dark"}}
        onPointerDown={invertTheme}
        icon={IconLightDark}
        theme="clear"
        size="sm"
      />

      <DeprecatedIconButton
        tooltip={{label: "Randomize Theme"}}
        onPointerDown={randomizeTheme}
        icon={IconDice}
        theme="clear"
        size="sm"
      />
    </div>
  );
}

export default ThemeTools;
