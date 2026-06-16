import { useSettingsState } from '@core/constant/SettingsState';
import type { ThemeMentionDecoratorProps } from '@lexical-core';
import { ThemeChips } from '@theme/components/ThemeChips';
import { setUserThemes, themes, userThemes } from '@theme/signals/themeSignals';
import type { ThemeV2 } from '@theme/types/themeTypes';
import { applyTheme } from '@theme/utils/themeUtils';
import { isThemeV2 } from '@theme/utils/themeValidation';
import { cn } from '@ui';
import { Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

export function ThemeMention(props: ThemeMentionDecoratorProps) {
  const { openSettings } = useSettingsState();
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const theme = (): ThemeV2 | null => {
    if (isThemeV2(props.data)) return props.data;
    return null;
  };

  const handleClick = () => {
    const t = theme();
    if (!t) return;

    const existing = themes().find((ut) => ut.id === t.id);
    if (!existing) {
      setUserThemes([...userThemes(), t]);
    }

    applyTheme(t.id);
    openSettings('Appearance');
  };

  return (
    <button
      class={cn(
        'pointer-events-auto mx-0.5 inline-flex items-stretch gap-0.75 align-baseline overflow-hidden py-0 pl-0 pr-1 rounded-md border border-edge-muted bg-transparent',
        isSelectedAsNode() && 'bg-active'
      )}
      onClick={handleClick}
      type="button"
    >
      <Show when={theme()}>
        {(t) => (
          <span class="rounded-md inline-flex self-stretch [&>span]:h-full [&>span]:border-0 [&>span]:rounded-[5px]">
            <ThemeChips theme={t()} size="sm" />
          </span>
        )}
      </Show>
      <span class="mx-0.5 flex items-center cursor-default">{props.name}</span>
    </button>
  );
}
