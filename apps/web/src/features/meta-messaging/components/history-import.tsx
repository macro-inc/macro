import InstagramIcon from '@phosphor/instagram-logo.svg';
import WhatsAppIcon from '@phosphor/whatsapp-logo.svg';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { MessagingProvider } from '../core/delivery';
import {
  type HistoryImport,
  historyActive,
  historyDescription,
  historyLabel,
  historyRecovery,
} from '../core/history';

/** Review provider limits and private-channel behavior before starting an import. */
export function HistoryImportControl(props: {
  provider: MessagingProvider;
  accountName: string;
  ready: boolean;
  canImport: boolean;
  reason?: string | null;
  job?: HistoryImport | null;
  pending: boolean;
  error?: string;
  onImport: () => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {historyLabel(props.job)}
      </Button>
      <Show when={open()}>
        <Dialog
          open
          onOpenChange={(value) => !props.pending && setOpen(value)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger?.focus();
          }}
          position="center"
          visibleScrim
          class="w-[min(520px,calc(100vw-24px))]"
        >
          <Panel
            depth={2}
            class="max-h-[calc(100dvh-32px)] rounded-2xl text-ink overflow-hidden"
          >
            <Panel.Header class="items-start gap-3 px-6 py-5">
              <div
                class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink/4 text-ink [&_svg]:size-6"
                aria-hidden="true"
              >
                {props.provider === 'instagram' ? (
                  <InstagramIcon />
                ) : (
                  <WhatsAppIcon />
                )}
              </div>
              <div class="min-w-0 space-y-1">
                <Dialog.Title class="text-base font-medium">
                  Import conversation history
                </Dialog.Title>
                <Dialog.Description class="text-sm text-ink-muted break-words">
                  {props.accountName}
                </Dialog.Description>
              </div>
            </Panel.Header>
            <Panel.Body class="space-y-5 overflow-y-auto px-6 py-5">
              <Show when={props.canImport || props.job}>
                <p class="text-sm leading-relaxed text-ink-muted">
                  Import past conversations into private Macro channels.
                  Existing conversations are reused.
                </p>
                <div class="space-y-1.5 rounded-lg bg-ink/4 p-3">
                  <h3 class="text-sm font-medium">What’s available</h3>
                  <p class="text-sm leading-relaxed text-ink-muted">
                    {historyDescription(props.provider)}
                  </p>
                </div>
                <p class="text-xs leading-relaxed text-ink-muted">
                  Importing sends no messages and doesn’t reopen reply windows.
                </p>
              </Show>
              <Show when={props.reason}>
                <p class="text-sm leading-relaxed text-ink-muted">
                  {props.reason}
                </p>
              </Show>
              <Show when={props.job}>
                {(job) => (
                  <>
                    <Show when={historyActive(job())}>
                      <p role="status" class="text-sm text-ink-muted">
                        {props.provider === 'whatsapp'
                          ? 'Keep WhatsApp Business open on your phone while history arrives.'
                          : 'Importing available conversations. You can close this dialog.'}
                        {job().progress != null ? ` ${job().progress}%` : ''}
                      </p>
                    </Show>
                    <Show when={job().status === 'complete'}>
                      <p role="status" class="text-sm text-ink-muted">
                        Available history imported. Open Channels to see your
                        conversations.
                      </p>
                    </Show>
                    <Show
                      when={
                        job().status === 'failed' || job().status === 'declined'
                      }
                    >
                      <p role="status" class="text-sm text-ink-muted">
                        {historyRecovery(job(), props.provider)}
                      </p>
                    </Show>
                    <Show when={job().unavailable_media}>
                      <p class="text-sm text-ink-muted">
                        Some attachments weren’t available. Their messages
                        include a notice so you can find them in the original
                        app.
                      </p>
                    </Show>
                  </>
                )}
              </Show>
              <Show when={props.error}>
                <p role="alert" class="text-sm text-failure">
                  {props.error}
                </p>
              </Show>
              <Show when={!props.ready && !props.error}>
                <p class="text-sm text-ink-muted">
                  Checking available history…
                </p>
              </Show>
            </Panel.Body>
            <Panel.Footer class="flex-wrap justify-end gap-2 px-6 py-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={props.pending}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Show when={props.error && !props.ready}>
                <Button variant="outline" size="sm" onClick={props.onRefresh}>
                  Retry
                </Button>
              </Show>
              <Show when={props.canImport}>
                <Button
                  variant="strong"
                  size="sm"
                  disabled={props.pending}
                  onClick={props.onImport}
                >
                  {props.pending
                    ? 'Starting…'
                    : props.job?.status === 'failed'
                      ? 'Resume import'
                      : 'Import available history'}
                </Button>
              </Show>
            </Panel.Footer>
          </Panel>
        </Dialog>
      </Show>
    </>
  );
}
