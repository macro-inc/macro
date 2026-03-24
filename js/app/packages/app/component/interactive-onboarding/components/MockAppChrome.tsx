import { SIDEBAR_LINKS } from '@app/component/app-sidebar/sidebar';
import { For, type JSX } from 'solid-js';
import MacroIcon from '@macro-icons/macro-logo.svg';
import { Dynamic } from 'solid-js/web';

interface MockAppChromeProps {
  viewTitle?: string;
  children?: JSX.Element;
}

export function MockAppChrome(props: MockAppChromeProps) {
  return (
    <div class="size-full p-4 bg-panel">
      <div class="flex size-full bg-page rounded-sm border border-edge-muted">
        {/* Mock sidebar */}
        <div class="px-3 shrink-0 bg-surface-secondary/50 flex flex-col items-center py-3 gap-3">
          <MacroIcon class="size-5 text-accent" />
          <For each={SIDEBAR_LINKS}>
            {(link) => (
              <div class="size-5 text-ink rounded-xs p-1 opacity-50">
                {link.icon && <Dynamic component={link.icon} />}
              </div>
            )}
          </For>
        </div>

        {/* Main area */}
        <div class="flex-1 min-w-0 flex flex-col m-1 ml-0 bg-panel border border-edge-muted rounded-sm">
          {/* Mock top bar */}
          <div class="h-10 shrink-0 border-b border-edge-muted flex items-center px-3">
            <span class="text-sm font-semibold text-ink/60">
              {props.viewTitle ?? 'Inbox'}
            </span>
          </div>

          {/* Content area */}
          <div class="flex-1 min-h-0 overflow-y-auto">{props.children}</div>
        </div>
      </div>
    </div>
  );
}
