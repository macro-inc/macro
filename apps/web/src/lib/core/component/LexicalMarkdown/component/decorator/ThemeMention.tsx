import { useSettingsState } from '@core/constant/SettingsState';
import type { ThemeMentionDecoratorProps } from '@macro-inc/lexical-core';
import { ThemeChips } from '@theme/components/ThemeChips';
import { setUserThemes, themes, userThemes } from '@theme/signals/themeSignals';
import type { ThemeV2 } from '@theme/types/themeTypes';
import { pinTheme } from '@theme/utils/themeUtils';
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

    pinTheme(t);
    openSettings('Appearance');
  };

  return (
    <span
      data-theme-mention="true"
      class={cn(
        'pointer-events-auto p-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active',
        isSelectedAsNode() && 'bg-active text-ink'
      )}
      onClick={handleClick}
    >
      <Show when={theme()}>
        {(t) => (
          <span class="relative inline-flex -top-0.75 mr-1">
            <ThemeChips theme={t()} size="inline" />
          </span>
        )}
      </Show>
      <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {props.name}
      </span>
    </span>
  );
}
