import { CommandState } from '@app/features/command';
import { globalSplitManager } from '@app/signal/splitLayout';
import { TOKENS } from '@core/hotkey/tokens';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Button, Hotkey } from '@ui';

/**
 * The window-level top bar: history navigation for whatever split is active,
 * and one always-visible search field that opens the command menu — the same
 * shape as Slack's. Desktop only; `Layout` renders it above the nav rails and
 * the splits, and touch devices keep their own per-view chrome.
 *
 * Back/forward act on the active split, which is what the per-split header's
 * own carets do — this is the same navigation reachable without hunting for
 * the right split's header.
 */
export const AppTopbar = () => {
  const activeSplit = () => globalSplitManager()?.activeSplit();

  return (
    <header
      data-ui="app-topbar"
      class="shrink-0 border-b border-edge-muted bg-surface pt-(--safe-top)"
    >
      <div class="flex h-9 items-center gap-2 px-2">
        <div class="flex flex-1 items-center gap-0.5">
          <Button
            aria-label="Back"
            class="size-7 rounded-md p-0 [&_svg]:size-4"
            label="Back"
            tooltipPlacement="bottom"
            disabled={!activeSplit()?.canGoBack()}
            onClick={() => activeSplit()?.goBack()}
          >
            <ArrowLeftIcon />
          </Button>
          <Button
            aria-label="Forward"
            class="size-7 rounded-md p-0 [&_svg]:size-4"
            label="Forward"
            tooltipPlacement="bottom"
            disabled={!activeSplit()?.canGoForward()}
            onClick={() => activeSplit()?.goForward()}
          >
            <ArrowRightIcon />
          </Button>
        </div>

        {/* A field, not a tooltip'd icon: the shortcut is rendered inside it. */}
        <Button
          aria-label="Search Macro"
          variant="base"
          class="h-7 w-full max-w-xl justify-start gap-2 rounded-lg px-2 text-xs font-normal text-ink-muted [&_svg]:size-4"
          onClick={() => CommandState.open()}
        >
          <MagnifyingGlassIcon class="shrink-0" />
          <span class="truncate">Search Macro</span>
          <Hotkey
            token={TOKENS.global.commandMenu}
            theme="subtle"
            class="ml-auto"
          />
        </Button>

        {/* Balances the history controls so the search field stays centered. */}
        <div class="flex-1" aria-hidden="true" />
      </div>
    </header>
  );
};
