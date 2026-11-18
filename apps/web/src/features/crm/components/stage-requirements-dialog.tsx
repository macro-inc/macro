import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Checkbox, Dialog, Dropdown, EntityComposer, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { canEditCell } from '../../database/core/table';
import type { StageRequirement } from '../core/stage-requirements';

/** Configure one stage at a time so saving cannot overwrite another stage's rules. */
export function StageRequirementsDialog(props: {
  columns: DatabaseViewColumn[];
  rules: StageRequirement[];
  onSave(rule: StageRequirement): Promise<void>;
  onClose(): void;
}) {
  const stages = () =>
    props.columns.filter(
      (column) => column.dataType === 'SELECT_STRING' && !column.isMultiSelect
    );
  const [columnId, setStageColumnId] = createSignal(
    stages().find((column) => column.name === 'Stage')?.id ?? stages()[0]?.id
  );
  const stageColumn = () => stages().find((column) => column.id === columnId());
  const [optionId, setStageId] = createSignal(stageColumn()?.options[0]?.id);
  const stage = () =>
    stageColumn()?.options.find((option) => option.id === optionId());
  const saved = () =>
    props.rules.find(
      (rule) => rule.columnId === columnId() && rule.optionId === optionId()
    );
  const [draft, setDraft] = createSignal<string[]>();
  const required = () => draft() ?? saved()?.fields ?? [];
  const [pending, setPending] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const fields = () =>
    props.columns.filter(
      (column) =>
        column.id !== columnId() &&
        !column.primary &&
        canEditCell(column) &&
        !column.relation
    );
  const selectStage = (id: string) => {
    setStageId(id);
    setDraft(undefined);
    setFailed(false);
  };
  const selectColumn = (id: string) => {
    setStageColumnId(id);
    setStageId(stageColumn()?.options[0]?.id);
    setDraft(undefined);
    setFailed(false);
  };
  async function save() {
    const column = columnId();
    const option = optionId();
    if (!column || !option || !stage() || pending()) return;
    setPending(true);
    setFailed(false);
    try {
      await props.onSave({
        columnId: column,
        optionId: option,
        fields: required().filter((id) =>
          fields().some((field) => field.id === id)
        ),
      });
      props.onClose();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  const close = () => !pending() && props.onClose();
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <Panel hideBorder class="bg-transparent rounded-[inherit] *:max-h-[80vh]">
        <Panel.Body>
          <form
            class="h-full min-h-0"
            onSubmit={(event) => {
              event.preventDefault();
              fireAndForget(save(), 'crm');
            }}
          >
            <EntityComposer.Root>
              <EntityComposer.Header>
                <Dialog.Title class="flex-1 text-base font-semibold">
                  {t('crm.stageRequirements')}
                </Dialog.Title>
                <Button
                  size="icon-md"
                  aria-label={t('common.close')}
                  disabled={pending()}
                  onClick={close}
                >
                  <XIcon />
                </Button>
              </EntityComposer.Header>
              <EntityComposer.Main class="gap-4 overflow-y-auto">
                <p class="text-sm text-ink-muted">
                  {t('crm.stageRequirementsDescription')}
                </p>
                <div class="flex flex-wrap gap-2">
                  <Dropdown>
                    <Dropdown.Trigger
                      disabled={pending()}
                      aria-label={t('crm.stageField')}
                    >
                      {stageColumn()?.name ?? t('crm.chooseStageField')}
                    </Dropdown.Trigger>
                    <Dropdown.Content>
                      <Dropdown.RadioGroup
                        value={columnId()}
                        onChange={selectColumn}
                      >
                        <For each={stages()}>
                          {(column) => (
                            <Dropdown.RadioItem value={column.id} closeOnSelect>
                              {column.name}
                            </Dropdown.RadioItem>
                          )}
                        </For>
                      </Dropdown.RadioGroup>
                    </Dropdown.Content>
                  </Dropdown>
                  <Dropdown>
                    <Dropdown.Trigger
                      disabled={pending()}
                      aria-label={t('crm.requiredStage')}
                    >
                      {stage()?.label ?? t('crm.chooseStage')}
                    </Dropdown.Trigger>
                    <Dropdown.Content>
                      <Dropdown.RadioGroup
                        value={optionId()}
                        onChange={selectStage}
                      >
                        <For each={stageColumn()?.options ?? []}>
                          {(option) => (
                            <Dropdown.RadioItem value={option.id} closeOnSelect>
                              {option.label}
                            </Dropdown.RadioItem>
                          )}
                        </For>
                      </Dropdown.RadioGroup>
                    </Dropdown.Content>
                  </Dropdown>
                </div>
                <Show
                  when={stage()}
                  fallback={
                    <p class="text-sm text-ink-muted">
                      {t('crm.stageOptionRequired')}
                    </p>
                  }
                >
                  <div class="flex flex-col gap-3">
                    <For each={fields()}>
                      {(column) => (
                        <Checkbox
                          checked={required().includes(column.id)}
                          disabled={pending()}
                          onChange={(checked) =>
                            setDraft(
                              checked
                                ? [...required(), column.id]
                                : required().filter((id) => id !== column.id)
                            )
                          }
                        >
                          <Checkbox.Control />
                          <Checkbox.Label>{column.name}</Checkbox.Label>
                        </Checkbox>
                      )}
                    </For>
                  </div>
                </Show>
                <p class="text-xs text-ink-muted">
                  {t('crm.stageRequirementsLifecycle')}
                </p>
                <Show when={failed()}>
                  <p role="alert" class="text-sm text-failure">
                    {t('crm.stageRequirementsSaveFailed')}
                  </p>
                </Show>
              </EntityComposer.Main>
              <EntityComposer.Footer class="justify-end">
                <Button
                  variant="secondary"
                  disabled={pending()}
                  onClick={close}
                >
                  {t('common.cancel')}
                </Button>
                <EntityComposer.Submit
                  type="submit"
                  hasContent={!!stage()}
                  disabled={pending() || !stage()}
                >
                  {pending()
                    ? t('crm.savingRequirements')
                    : t('crm.saveRequirements')}
                </EntityComposer.Submit>
              </EntityComposer.Footer>
            </EntityComposer.Root>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
