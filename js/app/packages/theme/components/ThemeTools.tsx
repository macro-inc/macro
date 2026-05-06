import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { Button } from '@ui/components/Button';
import { LabelAndHotKey } from '@core/component/Tooltip';
import IconLightDark from '@macro-icons/macro-light-dark.svg';
import { invertTheme, saveTheme } from '../utils/themeUtils';
import { randomizeTheme } from './ThemeEditorBasic';
import IconDice from '@macro-icons/macro-dice.svg';
import IconSave from '@macro-icons/macro-save.svg';
import { createMemo, Show } from 'solid-js';
import { cn } from '@ui/utils/classname';

export function ThemeTools() {
  let themeName!: HTMLDivElement;

  const defaultThemeName = 'New Theme';

  const currentThemeName = createMemo(() => {
    const theme = themes().find((theme) => theme.id === currentThemeId());
    if(isThemeSaved()){return theme?.name}
    else{return defaultThemeName}
  });

  return (
    <div
      style={{
        'gap': '4.5px' /* (41 - 32) / 2 */,
        'font-family': 'var(--font-sans)',
        'scrollbar-width': 'none',
        'align-items': 'center',
        'overflow': 'hidden',
        'font-size': '14px',
        'height': '39.5px',
        'display': 'flex',
        'width': '100%',
        'min-width': '0',
      }}
    >
      <div style={{ flex: 1 }}/>

      <Show when={!isThemeSaved()}>
        <Button
          onPointerDown={() => {
            saveTheme(themeName.innerText);
          }}
          tooltip={<LabelAndHotKey label="Save Theme" />}
          variant="ghost"
          size="icon-sm"
        >
          <IconSave />
        </Button>
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

      {/*<DeprecatedIconButton
        tooltip={{label: "Import From Clipboard"}}
        onPointerDown={importTheme}
        icon={IconImport}
        theme="clear"
        size="sm"
      />*/}

      <Button
        tooltip={<LabelAndHotKey label="Randomize Theme" />}
        onPointerDown={randomizeTheme}
        variant="ghost"
        size="icon-sm"
      >
        <IconDice />
      </Button>

      <Button
        tooltip={<LabelAndHotKey label="Toggle Light / Dark" />}
        onPointerDown={invertTheme}
        variant="ghost"
        size="icon-sm"
      >
        <IconLightDark />
      </Button>

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
        class={cn(
          'rounded-xs py-1.5 px-2 border text-xs outline-none',
          'bg-transparent text-ink-muted border-edge-muted',
          'hover:bg-input hover:text-ink',
          'focus:bg-input focus:text-ink',
          'min-w-0 overflow-hidden text-ellipsis',
        )}
        style={{
          'white-space': 'nowrap',
          'flex': '0 1 13rem',
          'min-width': '0',
        }}
        contentEditable={true}
        ref={themeName}
      >
        {currentThemeName()}
      </div>
    </div>
  );
}

export default ThemeTools;
