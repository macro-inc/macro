import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ActionDialogShell, Button, Dialog, TextField } from '@ui';
import { createSignal } from 'solid-js';
import { useContractsContext } from '../context/contracts-context';
import type { ContractDatabase } from '../core/database';

export function NewDatabaseDialog(props: {
  onClose: () => void;
  onCreated: (database: ContractDatabase) => void;
}) {
  const context = useContractsContext();
  const [name, setName] = createSignal('');
  const [saving, setSaving] = createSignal(false);

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name().trim();
    if (!trimmed) return;

    setSaving(true);
    const result = await context.createDatabase(trimmed);
    setSaving(false);
    if (result.isErr()) {
      toast.failure(t('contracts.actionFailed'));
      return;
    }
    props.onCreated(result.value);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="w-110"
      visibleScrim
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          onSubmit={(event) =>
            fireAndForget(create(event), 'contracts.create-database')
          }
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                {t('contracts.newDatabase')}
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {t('contracts.newDatabaseDescription')}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <TextField value={name()} onChange={setName}>
              <TextField.Label>{t('contracts.databaseName')}</TextField.Label>
              <TextField.Input
                placeholder={t('contracts.databaseNamePlaceholder')}
              />
            </TextField>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button variant="ghost" onClick={() => props.onClose()}>
              {t('contracts.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!name().trim()}
              loading={saving()}
            >
              {t('contracts.createDatabase')}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
