import SlackIcon from '@icon/mcp-slack.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';

export function SlackConnectCard(props: { onConnect(): void }) {
  return (
    <button
      type="button"
      aria-label="Import channels without history"
      class="flex w-full items-center gap-4 rounded-lg border border-edge-muted p-4 text-left hover:bg-ink/4 focus-visible:outline-accent"
      onClick={props.onConnect}
    >
      <SlackIcon aria-hidden="true" class="size-5 shrink-0 text-ink-muted" />
      <span class="flex-1 space-y-1">
        <span class="block text-sm font-medium text-ink">
          Import channels without history
        </span>
        <span class="block text-xs text-ink-muted">
          Copy public channels and teammates. No Slack admin role needed.
        </span>
      </span>
      <CaretRightIcon aria-hidden="true" class="size-4 text-ink-extra-muted" />
    </button>
  );
}
