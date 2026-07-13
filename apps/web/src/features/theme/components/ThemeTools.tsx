import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { saveTheme, updateTheme } from '../utils/themeUtils';
import IconSave from '@phosphor-icons/core/regular/floppy-disk-back.svg?component-solid';
import IconShuffle from '@phosphor-icons/core/regular/shuffle.svg?component-solid';
import { isMobile } from '@core/mobile/isMobile';
import { createMemo, Show } from 'solid-js';
import { Button, cn } from '@ui';

function ThemeTools(props: {
  class?: string;
  editingThemeId?: string;
  onRandomize?: () => void;
}) {
  let themeName!: HTMLDivElement;

  const defaultThemeName = 'New Theme';

  const editingTheme = () =>
    props.editingThemeId
      ? themes().find((theme) => theme.id === props.editingThemeId)
      : undefined;

  const currentThemeName = createMemo(() => {
    // While editing a custom theme, keep its name (even with unsaved edits).
    const editing = editingTheme();
    if (editing) return editing.name;
    const theme = themes().find((theme) => theme.id === currentThemeId());
    if(isThemeSaved()){return theme?.name}
    else{return defaultThemeName}
  });

  // Editing an existing custom theme writes back to it; otherwise save a new one.
  const commit = (rawName: string) => {
    const name = rawName.trim() || editingTheme()?.name || defaultThemeName;
    if (props.editingThemeId) {
      updateTheme(props.editingThemeId, name);
    } else {
      saveTheme(name);
    }
  };

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
      <div
        onKeyDown={(e) => {
          if(e.key === 'Enter'){
            e.preventDefault();
            const name = themeName.innerText.trim();
            if(name){
              commit(name);
              themeName.blur();
            }
            else { themeName.innerText = currentThemeName() ?? defaultThemeName; }
          }
        }}
        onBlur={() => {
          if(!themeName.innerText.trim()){
            themeName.innerText = currentThemeName() ?? defaultThemeName;
          }
        }}
        class={cn(
          'rounded-lg py-1.5 px-2 border text-xs outline-none',
          'bg-transparent text-ink-muted border-ink/[0.06]',
          'hover:bg-surface hover:text-ink',
          'focus:bg-surface focus:text-ink focus:border-accent',
          'min-w-0 overflow-hidden text-ellipsis',
        )}
        style={{
          'white-space': 'nowrap',
          // Narrower on mobile so it fits on the same line as the Basic/Advanced tabs.
          'flex': isMobile() ? '0 1 7.5rem' : '0 1 13rem',
          'min-width': '0',
        }}
        contentEditable={true}
        ref={themeName}
      >
        {currentThemeName()}
      </div>

      <Show when={props.onRandomize}>
        <Button
          onPointerDown={() => props.onRandomize?.()}
          label="Randomize theme"
          variant="ghost"
          size="icon-sm"
        >
          <IconShuffle />
        </Button>
      </Show>

      <Show when={!isThemeSaved()}>
        <Button
          onPointerDown={() => {
            commit(themeName.innerText);
          }}
          label={props.editingThemeId ? 'Save changes' : 'Save theme'}
          variant="ghost"
          size="icon-sm"
        >
          <IconSave />
        </Button>
      </Show>
    </div>
  );
}

export default ThemeTools;
