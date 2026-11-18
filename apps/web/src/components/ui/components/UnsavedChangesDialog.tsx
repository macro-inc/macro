import { t } from '@app/lib/i18n';
import { type JSX, Show } from 'solid-js';
import { ActionDialogShell } from './ActionDialogShell';
import { Button } from './Button';
import { Dialog } from './Dialog';

/** Shared three-way confirmation for leaving an editable page. */
export function UnsavedChangesDialog(props: {
  open: boolean;
  pending: boolean;
  canSave: boolean;
  error: string;
  title: JSX.Element;
  description: JSX.Element;
  cancelLabel: JSX.Element;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onKeepEditing()}
      onEscapeKeyDown={(event) => props.pending && event.preventDefault()}
      position="center"
      visibleScrim
      class="w-[min(28rem,calc(100vw-32px))]"
    >
      <ActionDialogShell>
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>{props.title}</ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {props.description}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <Show when={props.error}>
            <p role="alert" class="text-sm text-failure">
              {props.error}
            </p>
          </Show>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button
            type="button"
            variant="ghost"
            disabled={props.pending}
            onClick={props.onKeepEditing}
          >
            {props.cancelLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={props.pending}
            onClick={props.onDiscard}
          >
            {t('common.discard')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={props.pending || !props.canSave}
            onClick={props.onSave}
          >
            {props.pending ? t('common.saving') : t('common.save')}
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
