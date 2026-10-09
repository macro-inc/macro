import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';

export type MigrationPathTab = {
  id: string;
  icon?: () => JSX.Element;
  label: string;
  content: JSX.Element;
};

/** Matches the top navigation's Features control: a button-triggered popover
 * menu that closes on outside click or Escape. */
function ComparisonDropdown(props: {
  tabs: readonly MigrationPathTab[];
  activeTab: () => string | undefined;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  const openMenu = (last = false) => {
    setOpen(true);
    queueMicrotask(() => {
      const items =
        menuRef?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      items?.[last ? items.length - 1 : 0]?.focus();
    });
  };

  onMount(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open()) {
        setOpen(false);
        triggerRef?.focus();
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    onCleanup(() => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    });
  });

  const activeLabel = () =>
    props.tabs.find((tab) => tab.id === props.activeTab())?.label ??
    props.tabs[0]?.label;

  return (
    <div
      ref={menuRef}
      class="migrate-comparisons-dropdown"
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        class="migrate-comparisons-dropdown-trigger"
        aria-expanded={open()}
        aria-haspopup="menu"
        onClick={() => (open() ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(event.key === 'ArrowUp');
          }
        }}
      >
        <span class="migration-selector-label">
          {props.tabs.find((tab) => tab.id === props.activeTab())?.icon?.()}
          {activeLabel()}
        </span>
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 256 256"
          fill="currentColor"
          style={{
            transform: open() ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
          }}
        >
          <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
        </svg>
      </button>
      <Show when={open()}>
        <div
          class="migrate-comparisons-dropdown-menu"
          role="menu"
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement
            );
            let next = index;
            if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
            else if (event.key === 'ArrowUp')
              next = (index - 1 + buttons.length) % buttons.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = buttons.length - 1;
            else return;
            event.preventDefault();
            buttons[next]?.focus();
          }}
          aria-label="Choose what to bring over"
        >
          <For each={props.tabs}>
            {(tab) => (
              <button
                type="button"
                class="migrate-comparisons-dropdown-option"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  props.onSelect(tab.id);
                  setOpen(false);
                  triggerRef?.focus();
                }}
              >
                <span class="migration-selector-label">
                  {tab.icon?.()}
                  {tab.label}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Content-path tabs on desktop and a keyboard-accessible menu on smaller screens. */
export function MigrationPathSelector(props: {
  tabs: readonly MigrationPathTab[];
}) {
  // The panel content switches out of its desktop rail layout at this width,
  // so keep the surrounding tabs and spacing in the same compact mode.
  const mobile = () => viewportWidth() < 1200;
  const useSelectTabs = () => viewportWidth() < 1000;
  const [activeTab, setActiveTab] = createSignal(props.tabs[0]?.id);
  const active = () =>
    props.tabs.find((tab) => tab.id === activeTab()) ?? props.tabs[0];

  return (
    <section
      id="switch-from"
      aria-label="What do you want to bring over?"
      class="migrate-comparisons-section"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '28px' : '36px',
        'justify-items': 'stretch',
        'padding-block': mobile() ? '48px 36px' : '72px 48px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <style>{`
        .migration-selector-label { display: inline-flex; align-items: center; gap: 10px; }
        .migration-selector-label svg, .migrate-comparisons-tab svg { flex: none; }
        .migrate-comparisons-section { scroll-margin-top: 100px; }
        .migrate-comparisons-title { color: var(--c0); justify-self: start; margin: 0; }
        .migration-selector-body { min-width: 0; border: 1px solid color-mix(in srgb, var(--c4) 14%, transparent); border-radius: 16px; background: color-mix(in srgb, var(--b1) 72%, transparent); }
        .migrate-comparisons-tabs {
          box-sizing: border-box;
          padding: 10px 24px 0;
          border-bottom: 1px solid color-mix(in srgb, var(--c4) 16%, transparent);
          display: flex;
          gap: 4px;
          max-width: 100%;
          overflow-x: auto;
          scrollbar-width: none;
          width: 100%;
        }
        .migrate-comparisons-tabs::-webkit-scrollbar { display: none; }
        .migrate-comparisons-tab {
          background: transparent;
          border: 0;
          border-bottom: 2px solid transparent;
          color: var(--c4);
          cursor: default;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: body, sans-serif;
          font-size: 14px;
          font-weight: 600;
          line-height: 1;
          margin-bottom: -1px;
          padding: 12px 14px;
          white-space: nowrap;
        }
        .migrate-comparisons-tab[aria-selected='true'] { border-bottom-color: var(--a0); color: var(--c1); }
        .migrate-comparisons-tab:focus-visible { outline: 2px solid var(--a0); outline-offset: -3px; }
        .migrate-comparisons-dropdown { position: relative; width: 100%; }
        .migrate-comparisons-dropdown-trigger {
          align-items: center;
          background: transparent;
          border: 0;
          border-bottom: 1px solid color-mix(in srgb, var(--c4) 14%, transparent);
          border-radius: 16px 16px 0 0;
          color: var(--c1);
          cursor: default;
          display: flex;
          font-family: body, sans-serif;
          font-size: 14px;
          font-weight: 600;
          justify-content: space-between;
          line-height: 1;
          padding: 18px 20px;
          min-height: 56px;
          text-align: left;
          width: 100%;
        }
        .migrate-comparisons-dropdown-trigger:focus-visible { outline: 2px solid var(--a0); outline-offset: 2px; }
        .migrate-comparisons-dropdown-menu {
          background-color: var(--b2);
          border: 1px solid color-mix(in srgb, var(--b4) 24%, transparent);
          border-radius: 10px;
          box-shadow: 0 18px 40px color-mix(in srgb, #000 34%, transparent);
          box-sizing: border-box;
          display: grid;
          gap: 2px;
          left: 0;
          padding: 6px;
          position: absolute;
          top: calc(100% + 6px);
          width: 100%;
          z-index: 4;
        }
        .migrate-comparisons-dropdown-option {
          background: transparent;
          border: 0;
          border-radius: 6px;
          color: var(--c1);
          cursor: default;
          font-family: body, sans-serif;
          font-size: 14px;
          font-weight: 600;
          padding: 10px;
          text-align: left;
          width: 100%;
        }
        .migrate-comparison-panel {
          box-sizing: border-box;
          border-radius: 0 0 16px 16px;
          overflow: hidden;
          width: 100%;
        }
        @media (hover) {
          .migrate-comparisons-tab:hover { color: var(--c1); }
          .migrate-comparisons-dropdown-option:hover { background-color: color-mix(in srgb, var(--c4) 8%, transparent); }
        }
        @media (max-width: 1199px) {
          .migrate-comparisons-tab { font-size: 13px; padding: 11px 12px; }

        }
      `}</style>
      <h2
        class="migrate-comparisons-title"
        style={{
          'font-family': 'display',
          'font-size': mobile() ? '28px' : '36px',
          'font-weight': '315',
          'letter-spacing': '-0.015em',
          'line-height': 1.1,
        }}
      >
        What do you want to bring over?
      </h2>
      <div class="migration-selector-body">
        <Show
          when={useSelectTabs()}
          fallback={
            <div
              class="migrate-comparisons-tabs"
              role="tablist"
              aria-label="Choose what to bring over"
            >
              <For each={props.tabs}>
                {(tab) => {
                  const tabId = `migrate-comparison-tab-${tab.id}`;
                  const panelId = `migrate-comparison-panel-${tab.id}`;
                  return (
                    <button
                      id={tabId}
                      class="migrate-comparisons-tab"
                      type="button"
                      role="tab"
                      aria-controls={panelId}
                      aria-selected={activeTab() === tab.id}
                      tabIndex={activeTab() === tab.id ? 0 : -1}
                      onClick={() => setActiveTab(tab.id)}
                      onKeyDown={(event) => {
                        const index = props.tabs.findIndex(
                          (item) => item.id === tab.id
                        );
                        let next = index;
                        if (event.key === 'ArrowRight')
                          next = (index + 1) % props.tabs.length;
                        else if (event.key === 'ArrowLeft')
                          next =
                            (index - 1 + props.tabs.length) % props.tabs.length;
                        else if (event.key === 'Home') next = 0;
                        else if (event.key === 'End')
                          next = props.tabs.length - 1;
                        else return;
                        event.preventDefault();
                        setActiveTab(props.tabs[next].id);
                        document
                          .getElementById(
                            `migrate-comparison-tab-${props.tabs[next].id}`
                          )
                          ?.focus();
                      }}
                    >
                      {tab.icon?.()}
                      {tab.label}
                    </button>
                  );
                }}
              </For>
            </div>
          }
        >
          <ComparisonDropdown
            tabs={props.tabs}
            activeTab={activeTab}
            onSelect={setActiveTab}
          />
        </Show>
        <Show when={active()}>
          {(tab) => (
            <div
              id={`migrate-comparison-panel-${tab().id}`}
              class="migrate-comparison-panel"
              role={useSelectTabs() ? 'region' : 'tabpanel'}
              aria-label={
                useSelectTabs() ? `Bring over ${tab().label}` : undefined
              }
              aria-labelledby={
                useSelectTabs()
                  ? undefined
                  : `migrate-comparison-tab-${tab().id}`
              }
            >
              {tab().content}
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
