import TrashIcon from '@phosphor/trash.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import {
  ManagementCard,
  ManagementEditor,
} from '../../settings/management-primitives';

export function BotDeleteDialog(props: {
  open: boolean;
  botName?: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Show when={props.open}>
      <ManagementEditor
        parent={props.botName ?? 'Bot'}
        title={`Delete ${props.botName ?? 'bot'}?`}
        onBack={props.onClose}
        pending={props.pending}
      >
        <ManagementCard>
          <div class="flex flex-col gap-4 p-5">
            <p class="text-sm leading-5 text-ink-muted">
              This removes the bot from every channel and disables its webhook
              URLs. This action cannot be undone.
            </p>
            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={props.pending}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={props.pending}
                onClick={props.onConfirm}
              >
                <TrashIcon />
                {props.pending ? 'Deleting…' : 'Delete bot'}
              </Button>
            </div>
          </div>
        </ManagementCard>
      </ManagementEditor>
    </Show>
  );
}
