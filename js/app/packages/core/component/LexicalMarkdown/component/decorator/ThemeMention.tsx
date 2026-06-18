import { useSettingsState } from '@core/constant/SettingsState';
import type { ThemeMentionDecoratorProps } from '@lexical-core';
import { ThemeChipPill } from '@theme/components/ThemeChipPill';
import { setUserThemes, themes, userThemes } from '@theme/signals/themeSignals';
import type { ThemeV2 } from '@theme/types/themeTypes';
import { applyTheme } from '@theme/utils/themeUtils';
import { isThemeV2 } from '@theme/utils/themeValidation';
import { cn } from '@ui';
import { useContext } from 'solid-js';
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
    <ThemeChipPill
      type="button"
      onClick={handleClick}
      class={cn(
        'pointer-events-auto mx-0.5 align-baseline',
        isSelectedAsNode() && 'bg-active'
      )}
      theme={theme()}
      name={props.name}
    />
  );
}
