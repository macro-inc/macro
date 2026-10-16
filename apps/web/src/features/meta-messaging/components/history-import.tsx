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

/** A small account action; progress and provider limits stay in the existing settings dialog. */
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
          class="w-[min(480px,calc(100vw-16px))]"
        >
          <Panel depth={2} class="rounded-xl text-ink">
            <Panel.Header class="px-5 py-3">
              <Dialog.Title class="text-sm font-semibold">
                Import available history
              </Dialog.Title>
            </Panel.Header>
            <Panel.Body class="space-y-3 p-5">
              <p class="text-sm font-medium">{props.accountName}</p>
              <Dialog.Description class="text-sm leading-5 text-ink-muted">
                {historyDescription(props.provider)}
              </Dialog.Description>
              <p class="text-sm leading-5 text-ink-muted">
                Conversations appear as private Macro channels. Existing chats
                are reused. Importing sends no messages and doesn’t reopen reply
                windows.
              </p>
              <Show when={props.reason}>
                <p class="text-sm text-ink-muted">{props.reason}</p>
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
                <p role="alert" class="text-sm text-ink-muted">
                  {props.error}
                </p>
              </Show>
              <Show when={!props.ready && !props.error}>
                <p class="text-sm text-ink-muted">
                  Checking available history…
                </p>
              </Show>
            </Panel.Body>
            <Panel.Footer class="justify-end gap-2 px-5 py-3">
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
