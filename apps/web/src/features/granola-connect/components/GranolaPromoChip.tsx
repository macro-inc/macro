import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Show } from 'solid-js';
import { GRANOLA_APP_SLUG, GRANOLA_ICON_URL } from '../core/granola';

/** Invites the user to import their Granola meetings as calls. */
export function GranolaPromoChip(props: {
  onConnect: () => void;
  connecting: boolean;
}) {
  return (
    <button
      type="button"
      disabled={props.connecting}
      onClick={() => props.onConnect()}
      class="group flex w-full items-center gap-2.5 rounded-lg border border-accent/25 bg-linear-to-r from-accent/15 via-accent/5 to-success/10 px-2.5 py-2 text-left outline-none transition-colors hover:border-accent/45 hover:from-accent/20 focus-visible:border-edge-focus disabled:opacity-60"
    >
      <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-panel shadow-xs">
        <PipedreamConnectorIcon
          appSlug={GRANOLA_APP_SLUG}
          iconUrl={GRANOLA_ICON_URL}
          class="size-4"
        />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-ink">
          Connect Granola
        </span>
        <span class="block text-xs text-ink-muted">
          Import meetings as calls
        </span>
      </span>
      <Show
        when={props.connecting}
        fallback={
          <ArrowRightIcon class="size-3.5 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
        }
      >
        <SpinnerIcon class="size-3.5 shrink-0 animate-spin text-ink-muted" />
      </Show>
    </button>
  );
}
