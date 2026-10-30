import { TOKENS } from '@core/hotkey/tokens';
import { cn, ToggleSwitch, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { useChannelThreadPanel } from './thread-panel';

/**
 * Chooses whether threads collapse into a side panel or expand inline. Its
 * own pill beside the channel tabs, matching their frame. Touch devices show
 * one pane, so they keep threads inline and never offer it.
 */
export function ChannelThreadLayoutToggle() {
  const panel = useChannelThreadPanel();

  return (
    <Show when={panel?.available() ? panel : undefined}>
      {(panel) => (
        <Tooltip
          label={
            panel().enabled()
              ? 'Expand threads inline'
              : 'Collapse threads into a side panel'
          }
          hotkey={TOKENS.channel.toggleThreadPanel}
          class="shrink-0"
        >
          <div class="inline-flex min-h-8 items-stretch rounded-full border border-edge-button bg-control p-0.5">
            <ToggleSwitch
              label={panel().enabled() ? 'Collapse' : 'Expand'}
              checked={panel().enabled()}
              onChange={(checked) => panel().setEnabled(checked)}
              // A view choice, not a setting: a neutral borderless track.
              controlClass="border-transparent bg-ink/15 data-checked:border-transparent data-checked:bg-ink/60"
              class={cn(
                'shrink-0 self-stretch rounded-full border border-transparent px-2 py-0 text-sm font-medium whitespace-nowrap text-ink-muted transition-colors duration-120 select-none motion-reduce:transition-none',
                'not-touch:not-data-checked:hover:overlay-hover not-touch:not-data-checked:hover:text-ink data-checked:overlay-active data-checked:text-ink'
              )}
            />
          </div>
        </Tooltip>
      )}
    </Show>
  );
}
