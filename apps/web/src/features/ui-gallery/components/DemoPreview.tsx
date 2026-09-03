import { themeCssVars } from '@theme/utils/themeVNext';
import type { ThemeV3 } from '@theme/types/themeTypes';
import { cn, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';

export type PreviewSettings = {
  /** Rendered inside the preview only; null follows the app's active theme. */
  theme: ThemeV3 | null;
  depth: 0 | 1 | 2 | 3 | 4;
};

/**
 * The frame every demo renders inside.
 *
 * A theme is applied as inline custom properties on this element rather than on
 * the document, so the surrounding gallery chrome keeps the theme you are
 * actually working in while the component under review renders in another. That
 * is what lets the chrome stay stable — and it is accurate, because `@ui`
 * components read their colors entirely from inherited tokens.
 */
export function DemoPreview(props: {
  settings: PreviewSettings;
  /** Per-demo override of the page's depth control. */
  depth?: 0 | 1 | 2 | 3 | 4;
  fill?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  const depth = () => props.depth ?? props.settings.depth;
  const style = () => {
    const theme = props.settings.theme;
    return theme ? (themeCssVars(theme) as JSX.CSSProperties) : undefined;
  };

  // Mode-dependent styles key off `data-theme-light`, so a previewed theme has
  // to declare its own mode here or a light theme would keep rendering the
  // dark-mode treatment of whatever theme the app is in.
  const themeLight = () => {
    const theme = props.settings.theme;
    return theme ? String(theme.mode === 'light') : undefined;
  };

  return (
    <div
      class={cn(
        'rounded-md border border-edge-muted overflow-hidden',
        props.class
      )}
      data-theme-light={themeLight()}
      style={style()}
    >
      <Layer depth={depth()}>
        <div
          class={cn(
            'bg-surface p-6 min-h-32',
            props.fill
              ? 'block'
              : 'flex flex-wrap items-center justify-center gap-3'
          )}
        >
          {props.children}
        </div>
      </Layer>
    </div>
  );
}

/** Small caption used under previews to name what is being shown. */
export function PreviewCaption(props: { children: JSX.Element }) {
  return (
    <Show when={props.children}>
      <p class="text-xs text-ink-subtle">{props.children}</p>
    </Show>
  );
}
