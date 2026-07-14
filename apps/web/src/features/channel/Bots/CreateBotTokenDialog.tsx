import { toast } from '@core/component/Toast/Toast';
import KeyIcon from '@phosphor/key.svg';
import XIcon from '@phosphor/x.svg';
import { useCreateBotTokenMutation } from '@queries/bots/bots';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import { BotAvatar } from './BotAvatar';
import { CredentialField } from './CredentialField';

export function CreateBotTokenDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot?: Bot;
}) {
  const createTokenMutation = useCreateBotTokenMutation();
  const [label, setLabel] = createSignal('webhook');
  const [token, setToken] = createSignal<string>();

  const reset = () => {
    setLabel('webhook');
    setToken(undefined);
  };

  const close = () => {
    if (createTokenMutation.isPending) return;
    props.onOpenChange(false);
    reset();
  };

  const create = () => {
    const bot = props.bot;
    if (!bot) return;
    createTokenMutation.mutate(
      { botId: bot.id, label: label().trim() || undefined },
      {
        onSuccess: ({ bearer_token }) => setToken(bearer_token),
        onError: () => toast.failure('Failed to create token'),
      }
    );
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      onEscapeKeyDown={(event) =>
        createTokenMutation.isPending && event.preventDefault()
      }
      position="center"
      class="w-105"
    >
      <Panel depth={2} active class="rounded-xl text-ink">
        <Panel.Header class="px-5">
          <Dialog.Title class="text-sm font-semibold">
            New webhook token
          </Dialog.Title>
          <div class="ml-auto">
            <Button
              variant="ghost"
              size="icon-sm"
              label="Close"
              aria-label="Close"
              disabled={createTokenMutation.isPending}
              onClick={close}
            >
              <XIcon />
            </Button>
          </div>
        </Panel.Header>
        <Panel.Body class="p-5">
          <Show when={props.bot}>
            {(bot) => (
              <div class="flex flex-col gap-5">
                <div class="flex items-center gap-3 rounded-xl border border-edge-muted bg-ink/[0.02] p-3">
                  <BotAvatar bot={bot()} size="lg" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{bot().name}</div>
                    <div class="truncate text-xs text-ink-muted">
                      @{bot().handle}
                    </div>
                  </div>
                  <KeyIcon class="size-5 text-ink-extra-muted" />
                </div>

                <Show
                  when={token()}
                  fallback={
                    <>
                      <label class="flex flex-col gap-1.5">
                        <span class="text-xs font-medium text-ink">
                          Token label
                        </span>
                        <input
                          autofocus
                          value={label()}
                          placeholder="webhook"
                          class="settings-input w-full"
                          onInput={(event) =>
                            setLabel(event.currentTarget.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') create();
                          }}
                        />
                        <span class="text-xs text-ink-muted">
                          Use a label that describes where this token is used.
                        </span>
                      </label>
                      <div class="flex justify-end gap-2 border-t border-edge-muted pt-4">
                        <Button variant="ghost" size="sm" onClick={close}>
                          Cancel
                        </Button>
                        <Button
                          variant="cta"
                          size="sm"
                          disabled={createTokenMutation.isPending}
                          onClick={create}
                        >
                          {createTokenMutation.isPending
                            ? 'Creating…'
                            : 'Create token'}
                        </Button>
                      </div>
                    </>
                  }
                >
                  {(rawToken) => (
                    <>
                      <CredentialField
                        label="Webhook token"
                        value={rawToken()}
                        help="Shown only once"
                      />
                      <div class="rounded-lg border border-alert/30 bg-alert-bg px-3 py-2.5 text-xs text-alert-ink">
                        Store this token somewhere secure before closing.
                      </div>
                      <div class="flex justify-end border-t border-edge-muted pt-4">
                        <Button variant="cta" size="sm" onClick={close}>
                          Done
                        </Button>
                      </div>
                    </>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
