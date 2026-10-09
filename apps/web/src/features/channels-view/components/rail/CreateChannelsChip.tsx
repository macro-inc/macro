import { usePreference } from '@app/lib/preferences/use-preference';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import HashIcon from '@phosphor/hash.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

/** Channels a workspace needs before the nudge to create more goes away. */
const CHANNELS_BEFORE_CHIP_HIDES = 3;

/**
 * A temporary nudge at the top of the Chat sidebar for workspaces with few
 * channels. It goes away on its own once there are enough, or when dismissed.
 */
export function CreateChannelsChip(props: { channelCount: number }) {
  const [dismissed, setDismissed] = usePreference(
    'macro:pref:channels:create-chip-dismissed',
    { default: false }
  );

  return (
    <Show
      when={!dismissed() && props.channelCount < CHANNELS_BEFORE_CHIP_HIDES}
    >
      <section
        aria-label="Create a channel"
        class="relative mx-(--sidebar-gutter) flex flex-col gap-2 rounded-xl border border-edge-frame bg-control p-3"
      >
        <button
          type="button"
          aria-label="Dismiss"
          class="absolute top-2 right-2 flex size-5 items-center justify-center rounded-md text-ink-extra-muted hover:bg-hover hover:text-ink"
          onClick={() => setDismissed(true)}
        >
          <XIcon class="size-3" />
        </button>
        <div class="flex items-center gap-1.5 pr-6 text-sm font-medium text-ink">
          <HashIcon class="size-4 shrink-0 text-accent" />
          <span>Make a home for your team</span>
        </div>
        <p class="text-xs text-ink-muted">
          Channels keep each project, team, or topic in one place, so
          conversations don't get lost in DMs.
        </p>
        <Button
          variant="strong"
          size="sm"
          class="self-start"
          onClick={() => openNewChannelModal()}
        >
          Create a channel
        </Button>
      </section>
    </Show>
  );
}
