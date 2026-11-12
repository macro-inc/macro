import { MintCredential } from '@channel/Bots/MintCredential';
import type { WidgetOf } from '../view';

export type BotCredentialProps = Omit<WidgetOf<'botCredential'>, 'type'>;

/**
 * The card an IssueBotCredential result draws: the browser mints the token,
 * so its secret is shown here and never reaches the agent.
 */
export function BotCredential(props: BotCredentialProps) {
  return (
    <section
      class="flex w-full max-w-2xl min-w-0 flex-col gap-2 rounded-lg border border-edge-muted p-3"
      aria-label="Bot token"
    >
      <h3 class="text-sm font-semibold text-ink">
        Bot token
        {props.label ? ` · ${props.label}` : ''}
      </h3>
      <MintCredential
        botId={props.botId}
        label={props.label}
        expiresAt={props.expiresAt}
      />
    </section>
  );
}
