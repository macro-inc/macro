import type { ThemeMentionDecoratorProps, ThemeV1 } from '@lexical-core';
import { setUserThemes, userThemes } from '@block-theme/signals/themeSignals';
import { applyTheme } from '@block-theme/utils/themeUtils';
import { useSettingsState } from '@core/constant/SettingsState';

export function ThemeMention(props: ThemeMentionDecoratorProps) {
  const { openSettings } = useSettingsState();

  const a0 = () => props.tokens.a0;
  const b0 = () => props.tokens.b0;
  const c0 = () => props.tokens.c0;

  const oklch = (token: { l: number; c: number; h: number }) =>
    `oklch(${token.l} ${token.c} ${token.h}deg)`;

  const handleClick = () => {
    const theme = {
      id: props.id,
      name: props.name,
      version: props.version,
      tokens: props.tokens,
    };

    const existing = userThemes().find((t: ThemeV1) => t.id === theme.id);
    if (!existing) {
      setUserThemes([...userThemes(), theme]);
    }

    applyTheme(theme.id);
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
        <span style={{ 'margin-left': '2px', 'font-size': '0.9em' }}>
          {props.name}
        </span>
      </span>
    </span>
  );
}
