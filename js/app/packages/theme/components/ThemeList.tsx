import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { useAnalytics } from 'app/component/analytics-context';
import { applyTheme } from '../utils/themeUtils';
import { ColorSwatch } from './ColorSwatch';
import { ThemeCrud } from './ThemeCrud';

import { For } from 'solid-js';

export function ThemeList() {
  const analytics = useAnalytics()

  return (
    <>
      <style>{`
        .theme-list-item-name.current-theme{
          transition: none !important;
          color: var(--a0) !important;
        }

        @media(hover){
          .theme-list-item-name:hover{
            transition: none !important;
            color: var(--a0) !important;
          }
        }
      `}</style>

      <div
        style="
          font-family: var(--font-sans);
          background-color: var(--b0);
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
              border-bottom: 1px solid var(--b3);
              background-color: var(--b0);
              align-items: center;
              position: absolute;
              padding: 0 20px;
              display: flex;
              height: 42px;
              width: 100%;
              z-index: 1;
              top: 0;
              left: 0;
            "
          >
            <div
              style={{
                'font-size': '0.875rem',
                'font-weight': '600'
              }}
            >
              Theme List
            </div>
          </div>
          <div
            style="
              grid-template-columns: min-content 1fr min-content;
              background-color: var(--b3);
              box-sizing: border-box;
              grid-auto-rows: 40px;
              overflow-x: hidden;
              padding-top: 40px;
              display: grid;
              gap: 1px;
            "
          >
            <For each={themes()}>
              {(theme) => (
                <>
                  <div
                    style="
                      background-color: var(--b0);
                      box-sizing: border-box;
                      align-items: center;
                      padding: 0 20px;
                      display: flex;
                      height: 100%;
                      width: 100%;
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

                  <div
                    class={`theme-list-item-name ${theme.id === currentThemeId() && isThemeSaved() ? 'current-theme' : ''}`}
                    onClick={() => {
                      analytics.track('theme_changed', {themeId: theme.id})
                      applyTheme(theme.id)
                    }}
                    style="
                      transition: color var(--transition);
                      cursor: var(--cursor-pointer);
                      background-color: var(--b0);
                      box-sizing: border-box;
                      white-space: nowrap;
                      align-items: center;
                      padding: 0 20px;
                      display: flex;
                      height: 100%;
                      width: 100%;
                    "
                  >
                    {theme.name}
                  </div>

                  <ThemeCrud themeId={theme.id} />
                </>
              )}
            </For>
          </div>
        </div>
      </div>
    </>
  );
}

export default ThemeList;
