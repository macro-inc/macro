import KeyIcon from '@phosphor/key.svg';
import XIcon from '@phosphor/x.svg';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import { BotAvatar } from './BotAvatar';
import { MintCredential, useMintBotToken } from './MintCredential';

export function CreateBotTokenDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot?: Bot;
}) {
  const minted = useMintBotToken();
  const [label, setLabel] = createSignal('webhook');

  const reset = () => {
    setLabel('webhook');
    minted.reset();
  };

  const close = () => {
    if (minted.isPending()) return;
    props.onOpenChange(false);
    reset();
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      onEscapeKeyDown={(event) => minted.isPending() && event.preventDefault()}
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
              disabled={minted.isPending()}
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

                <MintCredential
                  minted={minted}
                  botId={bot().id}
                  label={label().trim() || undefined}
                  fieldLabel="Webhook token"
                  fieldHelp="Shown only once"
                  fallback={({ mint, isPending }) => (
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
                            if (event.key === 'Enter') mint();
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
                          disabled={isPending}
                          onClick={mint}
                        >
                          {isPending ? 'Creating…' : 'Create token'}
                        </Button>
                      </div>
                    </>
                  )}
                  afterToken={
                    <>
                      <div class="rounded-lg border border-alert/30 bg-alert-bg px-3 py-2.5 text-xs text-alert-ink">
                        Store this token somewhere secure before closing.
                      </div>
                      <div class="flex justify-end border-t border-edge-muted pt-4">
                        <Button variant="cta" size="sm" onClick={close}>
                          Done
                        </Button>
                      </div>
                    </>
                  }
                />
              </div>
            )}
          </Show>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
