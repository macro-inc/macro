import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { useAnalytics } from 'app/component/analytics-context';
import { applyTheme } from '../utils/themeUtils';
import { ColorSwatch } from './ColorSwatch';
import { cn } from '@ui/utils/classname';

import { For } from 'solid-js';

export function ThemeList() {
  const analytics = useAnalytics()

  return (
    <>
      <style>{`
        .theme-list-item.current-theme{
          transition: none !important;
          color: var(--a0) !important;

          .theme-list-item-name{
            transition: none !important;
            color: var(--a0) !important;
          }

          .theme-color-swatch{
            border-color: var(--a0) !important;
            transition: none !important;
          }

          hr{
            border-color: var(--a0) !important;
            transition: none !important;
          }
        }

        @media(hover){
          .theme-list-item:hover{
            transition: none;
            color: var(--a0);

            .theme-list-item-name{
              transition: none !important;
              color: var(--a0) !important;
            }

            .theme-color-swatch{
              border-color: var(--a0) !important;
              transition: none !important;
            }

            hr{
              border-color: var(--a0) !important;
              transition: none !important;
            }
          }
        }
      `}</style>

      <div
        style="
          font-family: var(--font-sans);
          scrollbar-width: none;
          position: relative;
          overflow: hidden;
          font-size: 14px;
          display: block;
          height: 100%;
        "
      >
        <div
          style="
            overscroll-behavior: none;
            box-sizing: border-box;
            scrollbar-width: none;
            overflow-y: scroll;
            height: 100%;
            width: 100%;
          "
        >
          <div
            style="
              box-sizing: border-box;
              overflow-x: hidden;
              display: grid;
            "
          >
            <div
              style="
                align-items: center;
                position: absolute;
                padding: 0 20px;
                display: grid;
                height: 42px;
                width: 100%;
                z-index: 1;
                border-bottom: 1px solid oklch(from var(--color-edge-muted) l c h / 0.5);
              "
            >
              <div style="font-size: var(--text-xs);">Theme List</div>
            </div>
            <div style="height: 40px;" />
          <For each={themes()}>
            {(theme) => (
              <div
                class={cn(
                  'theme-list-item font-mono text-xs text-ink-extra-muted',
                  theme.id === currentThemeId() && isThemeSaved() && 'current-theme'
                )}
                onClick={() => {
                  analytics.track('theme_changed', {themeId: theme.id})
                  applyTheme(theme.id)
                }}
                style="
                  grid-template-columns: min-content 1fr min-content;
                  cursor: var(--cursor-pointer);
                  align-items: center;
                  padding: 10px 20px;
                  display: grid;
                  gap: 20px;
                "
              >
                <div
                  style="
                  grid-template-columns: repeat(3, min-content);
                  display: grid;
                  gap: 5px;
                "
                >
                  <ColorSwatch
                    color={`oklch(${theme.tokens.a0.l} ${theme.tokens.a0.c} ${theme.tokens.a0.h}deg)`}
                    width={'10px'}
                  />
                  <ColorSwatch
                    color={`oklch(${theme.tokens.b0.l} ${theme.tokens.b0.c} ${theme.tokens.b0.h}deg)`}
                    width={'10px'}
                  />
                  <ColorSwatch
                    color={`oklch(${theme.tokens.c0.l} ${theme.tokens.c0.c} ${theme.tokens.c0.h}deg)`}
                    width={'10px'}
                  />
                </div>

                <hr
                  style="
                    border: none;
                    border-top: 1px dashed var(--color-edge-muted);
                    transition: border-color var(--transition);
                    box-sizing: border-box;
                    width: 100%;
                  "
                />

                <div
                  class="theme-list-item-name"
                  style="
                    transition: color var(--transition);
                    white-space: nowrap;
                  "
                >
                  {theme.name}
                </div>
              </div>
            )}
          </For>
          </div>
        </div>
      </div>
    </>
  );
}

export default ThemeList;
