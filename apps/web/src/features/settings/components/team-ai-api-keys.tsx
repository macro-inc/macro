/**
 * The team's own Anthropic and OpenAI keys for AI chat. Every member sees
 * which providers have a key; admins and the owner add, replace, or remove
 * them. A stored key is never shown again.
 */

import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import { formatRelativeTimestamp } from '@entity';
import {
  useRemoveTeamAiApiKey,
  useSaveTeamAiApiKey,
  useTeamAiApiKeysQuery,
} from '@queries/auth/team-ai-api-keys';
import type { TeamAiProvider } from '@service-auth/generated/schemas/teamAiProvider';
import { Button, confirmDialog } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { SettingsCard, SettingsRow, SettingsSection } from '../primitives';

const PROVIDERS: { id: TeamAiProvider; name: string; placeholder: string }[] = [
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-…' },
];

export const TEAM_AI_API_KEYS_DESCRIPTION =
  "Only applies to AI chat. When a member runs out of Macro AI usage, chat continues on your team's key, billed by the provider and not counted against Macro usage. AI editing, call transcription, and other AI features keep using Macro usage.";

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

export function TeamAiApiKeys(props: { canManage: boolean }) {
  const keys = useTeamAiApiKeysQuery();
  const save = useSaveTeamAiApiKey();
  const remove = useRemoveTeamAiApiKey();
  const [drafts, setDrafts] = createSignal<
    Partial<Record<TeamAiProvider, string>>
  >({});

  const stored = (provider: TeamAiProvider) =>
    keys.data?.keys.find((key) => key.provider === provider);
  const draft = (provider: TeamAiProvider) => drafts()[provider] ?? '';
  const setDraft = (provider: TeamAiProvider, value: string) =>
    setDrafts((current) => ({ ...current, [provider]: value }));

  const handleSave = async (provider: TeamAiProvider, name: string) => {
    const apiKey = draft(provider).trim();
    if (apiKey.length === 0 || save.isPending) return;
    try {
      await save.mutateAsync({ provider, apiKey });
      setDraft(provider, '');
      toast.success(`${name} key saved`);
    } catch (error) {
      toast.failure(failureMessage(error, `Failed to save the ${name} key`));
    }
  };

  const handleRemove = async (provider: TeamAiProvider, name: string) => {
    if (remove.isPending) return;
    const confirmed = await confirmDialog({
      title: `Remove the ${name} key?`,
      body: `AI chat stops using your team's ${name} key. This removes Macro's copy of the key but does not revoke it at ${name}.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(provider);
      toast.success(`${name} key removed`);
    } catch (error) {
      toast.failure(failureMessage(error, `Failed to remove the ${name} key`));
    }
  };

  return (
    <SettingsSection
      title="AI chat API keys"
      description={TEAM_AI_API_KEYS_DESCRIPTION}
    >
      <SettingsCard>
        <For each={PROVIDERS}>
          {(provider) => (
            <SettingsRow
              label={provider.name}
              description={
                <Show
                  when={stored(provider.id)}
                  fallback={keys.isLoading ? 'Loading…' : 'No key'}
                >
                  {(key) =>
                    `Key saved ${formatRelativeTimestamp(key().updatedAt)}`
                  }
                </Show>
              }
              stackOnNarrow
            >
              <Show
                when={props.canManage}
                fallback={
                  <span class="text-xs text-ink-muted">
                    {stored(provider.id) ? 'Connected' : 'Not set'}
                  </span>
                }
              >
                <div class="flex min-w-0 items-center gap-2">
                  <input
                    type="password"
                    autocomplete="off"
                    spellcheck={false}
                    aria-label={`${provider.name} API key`}
                    class="settings-input ph-no-capture w-44 min-w-0"
                    placeholder={
                      stored(provider.id) ? 'Replace key' : provider.placeholder
                    }
                    value={draft(provider.id)}
                    onInput={(event) =>
                      setDraft(provider.id, event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        void handleSave(provider.id, provider.name);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      draft(provider.id).trim().length === 0 || save.isPending
                    }
                    onClick={() => void handleSave(provider.id, provider.name)}
                  >
                    Save
                  </Button>
                  <Show when={stored(provider.id)}>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() =>
                        void handleRemove(provider.id, provider.name)
                      }
                    >
                      Remove
                    </Button>
                  </Show>
                </div>
              </Show>
            </SettingsRow>
          )}
        </For>
      </SettingsCard>
    </SettingsSection>
  );
}
