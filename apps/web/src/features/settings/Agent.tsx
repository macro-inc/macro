import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useEmailLinksQuery } from '@queries/email/link';
import { useUpdateEmailSettingsMutation } from '@queries/email/settings';
import { ToggleSwitch } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

/**
 * The "MCP server" tab: setup instructions for pointing other agents and MCP
 * clients (Claude Code, Codex, IDEs, ...) at Macro's own MCP server, plus the
 * per-inbox opt-in that lets those clients send email. Managing Macro's
 * outbound connectors lives on the Integrations tab (see `Integrations.tsx`).
 */
export function Agent() {
  return (
    <SettingsPage
      title="Macro MCP server"
      description="Connect other agents and tools to your Macro workspace."
    >
      <McpSetupCards class="max-w-none" />
      <EmailSendingSection />
    </SettingsPage>
  );
}

/**
 * Per-inbox switch for `email_settings.mcp_send_enabled`. Off by default:
 * MCP clients can always save drafts the user sends from Macro, but they
 * only send directly from inboxes turned on here. Delegated inboxes are not
 * listed — only an inbox's owner can open it to agents.
 */
function EmailSendingSection() {
  const userId = useUserId();
  const linksQuery = useEmailLinksQuery();
  const updateSettings = useUpdateEmailSettingsMutation();

  const ownInboxes = createMemo(() => {
    if (!linksQuery.isSuccess) return [];
    const uid = userId();
    return linksQuery.data.links.filter((link) => link.macro_id === uid);
  });

  const setSendEnabled = (linkId: string, enabled: boolean) => {
    updateSettings.mutate(
      { linkId, settings: { mcp_send_enabled: enabled } },
      { onError: () => toast.failure('Failed to update setting.') }
    );
  };

  return (
    <Show when={ownInboxes().length > 0}>
      <SettingsSection
        title="Email sending"
        description="Connected agents can always save drafts for you to send from Macro. Let them send directly, per inbox."
      >
        <SettingsCard>
          <For each={ownInboxes()}>
            {(link) => (
              <SettingsRow
                label={<span class="ph-no-capture">{link.email_address}</span>}
                description="Allow connected agents to send email from this inbox"
              >
                <ToggleSwitch
                  size="md"
                  checked={link.settings.mcp_send_enabled ?? false}
                  disabled={updateSettings.isPending}
                  onChange={(enabled) => setSendEnabled(link.id, enabled)}
                />
              </SettingsRow>
            )}
          </For>
        </SettingsCard>
      </SettingsSection>
    </Show>
  );
}
