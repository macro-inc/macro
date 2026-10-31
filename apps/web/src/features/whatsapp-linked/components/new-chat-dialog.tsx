import { fireAndForget } from '@core/util/fireAndForget';
import { ActionDialogShell, Button, Dialog, TextField } from '@ui';
import type { ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import {
  type NewChatFailure,
  newChatFailureMessage,
  normalizePhoneNumber,
} from '../core/new-chat';

/**
 * Start a direct chat with a phone number that isn't in the chat list:
 * WhatsApp is asked whether it has an account, and a found number's chat is
 * added and opened. Stays open with the reason when it can't.
 */
export function NewChatDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (phoneNumber: string) => ResultAsync<unknown, NewChatFailure>;
}) {
  const [typed, setTyped] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal<string>();

  const close = (open: boolean) => {
    if (pending()) return;
    if (!open) {
      setTyped('');
      setFailure(undefined);
    }
    props.onOpenChange(open);
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending()) return;
    const phoneNumber = normalizePhoneNumber(typed());
    if (!phoneNumber) {
      setFailure(newChatFailureMessage({ reason: 'invalid-number' }));
      return;
    }
    setFailure(undefined);
    setPending(true);
    const result = await props.onStart(phoneNumber);
    setPending(false);
    if (result.isErr()) {
      setFailure(newChatFailureMessage(result.error));
      return;
    }
    close(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={close}
      position="center"
      class="ph-no-capture w-110"
      visibleScrim
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          aria-busy={pending()}
          onSubmit={(event) =>
            fireAndForget(submit(event), 'whatsapp-linked.new-chat')
          }
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                New WhatsApp chat
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                Message anyone on WhatsApp by their phone number.
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <TextField
              value={typed()}
              onChange={(value) => {
                setTyped(value);
                setFailure(undefined);
              }}
              validationState={failure() ? 'invalid' : 'valid'}
            >
              <TextField.Label>Phone number</TextField.Label>
              <TextField.Input
                type="tel"
                inputMode="tel"
                autocomplete="tel"
                placeholder="+ country code and number"
                readOnly={pending()}
                autofocus
              />
              <TextField.ErrorMessage>{failure()}</TextField.ErrorMessage>
            </TextField>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              disabled={pending()}
              onClick={() => close(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending() || typed().trim() === ''}
            >
              {pending() ? 'Looking up…' : 'Start chat'}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
