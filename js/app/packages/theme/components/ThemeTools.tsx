import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import IconLightDark from '@icon/macro-light-dark.svg';
import { invertTheme, saveTheme } from '../utils/themeUtils';
import { randomizeTheme } from './ThemeEditorBasic';
import IconDice from '@phosphor-icons/core/regular/dice-five.svg?component-solid';
import IconSave from '@phosphor-icons/core/regular/floppy-disk-back.svg?component-solid';
import { createMemo, Show } from 'solid-js';
import { Button, cn } from '@ui';

export function ThemeTools(props: { class?: string }) {
  let themeName!: HTMLDivElement;

  const defaultThemeName = 'New Theme';

  const currentThemeName = createMemo(() => {
    const theme = themes().find((theme) => theme.id === currentThemeId());
    if(isThemeSaved()){return theme?.name}
    else{return defaultThemeName}
  });

  return (
    <div
      class={cn('flex items-center overflow-hidden w-full min-w-0', props.class)}
      style={{
        'gap': '4.5px' /* (41 - 32) / 2 */,
        'font-family': 'var(--font-sans)',
        'scrollbar-width': 'none',
        'font-size': '14px',
        'height': '39.5px',
      }}
    >
      <div style={{ flex: 1 }}/>

      <Show when={!isThemeSaved()}>
        <Button
          onPointerDown={() => {
            saveTheme(themeName.innerText);
          }}
          label="Save Theme"
          variant="ghost"
          size="icon-sm"
        >
          <IconSave />
        </Button>
      </Show>

      <Button
        label="Randomize Theme"
        onPointerDown={randomizeTheme}
        variant="ghost"
        size="icon-sm"
      >
        <IconDice />
      </Button>

      <Button
        label="Toggle Light / Dark"
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
          'hover:bg-surface hover:text-ink',
          'focus:bg-surface focus:text-ink',
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
