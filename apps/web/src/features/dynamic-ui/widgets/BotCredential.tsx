import { MintCredential } from '@channel/Bots/MintCredential';
import { useBotQuery } from '@queries/bots/bots';
import { Show } from 'solid-js';
import type { WidgetOf } from '../view';

export type BotCredentialProps = Omit<WidgetOf<'botCredential'>, 'type'>;

/**
 * A card an agent presents so the user mints a bot token: the browser mints
 * it, so its secret is shown here and never reaches the agent. It names the
 * bot as the viewer loads it, and shows nothing for a bot they cannot read.
 */
export function BotCredential(props: BotCredentialProps) {
  const bot = useBotQuery(() => props.botId);
  return (
    // Read data only once loaded: a pending read suspends the whole view.
    <Show when={bot.isSuccess && bot.data}>
      {(loaded) => (
        <section
          class="flex w-full max-w-2xl min-w-0 flex-col gap-2 rounded-lg border border-edge-muted p-3"
          aria-label={`Token for ${loaded().name}`}
        >
          <h3 class="text-sm font-semibold text-ink">
            Token for {loaded().name}
            {props.label ? ` · ${props.label}` : ''}
          </h3>
          <MintCredential
            botId={props.botId}
            label={props.label}
            expiresAt={props.expiresAt}
          />
        </section>
      )}
    </Show>
  );
}
