import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { useChatV3AgentsFlag } from '../use-chat-v3-agents-flag';
import { BotFormSection } from './BotFormSection';

const HERMES_GUIDE = `
1. **Create this bot and copy its token.** The token is shown only once.

2. **Install and configure Hermes.**

   \`\`\`bash
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   hermes setup
   hermes-acp --check
   \`\`\`

3. **[Download macrod from the latest Macro release](https://github.com/macro-inc/macro/releases/latest)** for your operating system and architecture.

4. **Expose port 8790 to Macro.** macrod receives webhooks at \`POST /macro-events\`, so it needs a public HTTPS endpoint. The quickest option is a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

   \`\`\`bash
   cloudflared tunnel --url http://localhost:8790
   \`\`\`

   Cloudflare prints a temporary \`https://....trycloudflare.com\` URL. Use that URL plus \`/macro-events\` as \`public_url\`. The URL changes when the tunnel restarts; use a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/) for a stable bot.

5. **Create \`macro.toml\`.**

   \`\`\`toml
   [macro]
   api_url = "https://agent-harness.macro.com"
   storage_url = "https://cloud-storage.macro.com"
   owner_user_id = "macro|you@example.com"
   bot_token = "mbot_..."
   bot_scope = "user"

   [server]
   port = 8790
   public_url = "https://your-tunnel.trycloudflare.com/macro-events"

   [harness]
   command = "hermes-acp"
   args = []

   [workspace]
   path = "/absolute/path/to/your/repository"
   repo_url = "https://github.com/you/your-repository"
   \`\`\`

   Change \`you@example.com\` in \`owner_user_id\` to the email address you use to sign in to Macro. Replace \`mbot_...\` with the bot token from step 1. For a team-owned bot, use \`bot_scope = "team"\`.

6. **Start macrod, then mention the bot in one of its channels.**

   \`\`\`bash
   ./macrod --config ./macro.toml
   \`\`\`
`;

/**
 * The "Coding agent" toggle. Hidden entirely unless the chat v3 agents flag is
 * on, so bots stay plain webhook bots for everyone else.
 */
export function BotAgentSection(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const agentsEnabled = useChatV3AgentsFlag();

  return (
    <Show when={agentsEnabled()}>
      <BotFormSection
        title="Agent"
        description="Turn this bot into a coding agent instead of a webhook responder."
      >
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-sm font-medium text-ink">Agent Harness</div>
            <p class="mt-0.5 text-xs text-ink-muted">
              This bot manages an agent harness like Codex or Hermes
            </p>
          </div>
          <ToggleSwitch
            size="md"
            checked={props.checked}
            disabled={props.disabled}
            onChange={props.onChange}
            label={<span>Make this bot a coding agent</span>}
            labelClass="sr-only"
          />
        </div>

        <Show when={props.checked}>
          <details class="group mt-4 border-t border-edge-muted pt-3">
            <summary class="flex list-none items-center gap-2 text-xs font-medium text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
              <CaretRightIcon class="size-3 shrink-0 transition-transform group-open:rotate-90" />
              Connecting an agent?
            </summary>
            <div class="mt-3 rounded-lg bg-ink/[0.025] px-3 py-2 text-xs text-ink-muted">
              <StaticMarkdownContext>
                <StaticMarkdown markdown={HERMES_GUIDE} target="external" />
              </StaticMarkdownContext>
            </div>
          </details>
        </Show>
      </BotFormSection>
    </Show>
  );
}
