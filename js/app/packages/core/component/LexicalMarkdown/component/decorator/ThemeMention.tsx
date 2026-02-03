import type { ThemeMentionDecoratorProps } from '@lexical-core';
import type { ThemeV1 } from '@block-theme/types/themeTypes';
import { isThemeV1 } from '@block-theme/utils/themeValidation';
import { setUserThemes, userThemes } from '@block-theme/signals/themeSignals';
import { applyTheme } from '@block-theme/utils/themeUtils';
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

    const existing = userThemes().find((ut: ThemeV1) => ut.id === t.id);
    if (!existing) {
      setUserThemes([...userThemes(), t]);
    }

    applyTheme(t.id);
    openSettings('Appearance');
  };

  return (
    <span
      class="pointer-events-auto"
      style={{ cursor: 'var(--cursor-pointer)' }}
      onClick={handleClick}
    >
      <span
        style={{
          display: 'inline-flex',
          'align-items': 'center',
          gap: '3px',
          'vertical-align': 'baseline',
          padding: '1px 4px',
          'border-radius': '3px',
          border: '1px solid var(--color-edge-muted)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            gap: '2px',
            'align-items': 'center',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              'border-radius': '2px',
              'background-color': oklch(a0()),
              border: '1px solid var(--color-edge-muted)',
            }}
          />
          <span
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              'border-radius': '2px',
              'background-color': oklch(b0()),
              border: '1px solid var(--color-edge-muted)',
            }}
          />
          <span
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              'border-radius': '2px',
              'background-color': oklch(c0()),
              border: '1px solid var(--color-edge-muted)',
            }}
          />
        </span>
        <span style={{ 'margin-inline': '2px', cursor: 'default' }}>
          {props.name}
        </span>
      </span>
    </span>
  );
}
