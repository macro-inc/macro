import type { ThemeMentionDecoratorProps } from '@lexical-core';
import type { ThemeV1 } from '@theme/types/themeTypes';
import { isThemeV1 } from '@theme/utils/themeValidation';
import { setUserThemes, themes, userThemes } from '@theme/signals/themeSignals';
import { applyTheme } from '@theme/utils/themeUtils';
import { useSettingsState } from '@core/constant/SettingsState';

export function ThemeMention(props: ThemeMentionDecoratorProps) {
  const { openSettings } = useSettingsState();

  const theme = (): ThemeV1 | null => {
    if (isThemeV1(props.data)) return props.data;
    return null;
  };

  const a0 = () => theme()?.tokens.a0;
  const b0 = () => theme()?.tokens.b0;
  const c0 = () => theme()?.tokens.c0;

  const oklch = (token: { l: number; c: number; h: number } | undefined) => {
    if (!token) return 'transparent';
    return `oklch(${token.l} ${token.c} ${token.h}deg)`;
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
    <span class="pointer-events-auto mx-0.5" onClick={handleClick}>
      <span class="inline-flex items-center gap-0.75 align-baseline px-1 py-px rounded-[3px] border border-edge-muted">
        <span class="inline-flex items-center gap-0.5">
          <span
            class="inline-block size-2.5 rounded-xs border border-edge-muted"
            style={{ 'background-color': oklch(a0()) }}
          />
          <span
            class="inline-block size-2.5 rounded-xs border border-edge-muted"
            style={{ 'background-color': oklch(b0()) }}
          />
          <span
            class="inline-block size-2.5 rounded-xs border border-edge-muted"
            style={{ 'background-color': oklch(c0()) }}
          />
        </span>
        <span class="mx-0.5 cursor-default">{props.name}</span>
      </span>
    </span>
  );
}
