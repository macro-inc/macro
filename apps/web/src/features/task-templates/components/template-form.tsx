import { t } from '@app/lib/i18n';
import {
  Button,
  Checkbox,
  Dialog,
  type ManagedDialogProps,
  TextField,
} from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

/** Template fields stay independent of mutations and dialog lifecycle policy. */
export function TemplateForm(
  props: ManagedDialogProps & {
    name: string;
    editing: boolean;
    team?: { id: string; name: string };
    shared: boolean;
    pending: boolean;
    canSave: boolean;
    error?: string;
    properties: JSX.Element;
    descriptionMarkdown: string;
    onDescriptionChange(value: string): void;
    onSave(name: string, teamId: string | null): void;
  }
) {
  const [name, setName] = createSignal(props.name);
  const [shared, setShared] = createSignal(props.shared);
  return (
    <form
      class="flex flex-col gap-5 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.pending || !props.canSave || !name().trim()) return;
        props.onSave(name().trim(), shared() ? (props.team?.id ?? null) : null);
      }}
    >
      <Dialog.Title class="text-base font-medium">
        {props.editing
          ? t('create.taskTemplateEditTitle')
          : t('create.taskTemplateSaveTitle')}
      </Dialog.Title>
      <TextField
        value={name()}
        onChange={setName}
        disabled={props.pending}
        required
      >
        <TextField.Label>{t('create.taskTemplateName')}</TextField.Label>
        <TextField.Input
          placeholder={t('create.taskTemplateNamePlaceholder')}
          maxLength={120}
        />
      </TextField>
      <fieldset disabled={props.pending} class="flex min-w-0 flex-col gap-2">
        <legend class="mb-2 text-sm font-medium">
          {t('create.taskTemplateProperties')}
        </legend>
        {props.properties}
      </fieldset>
      <TextField
        value={props.descriptionMarkdown}
        onChange={props.onDescriptionChange}
        disabled={props.pending}
      >
        <TextField.Label>{t('create.taskTemplateDescription')}</TextField.Label>
        <TextField.TextArea autoResize rows={5} maxLength={16384} />
        <TextField.Description>
          {t('create.taskTemplateMarkdownHint')}
        </TextField.Description>
      </TextField>
      <Show when={!props.editing && props.team}>
        {(team) => (
          <div class="flex flex-col gap-2">
            <Checkbox
              checked={shared()}
              onChange={setShared}
              disabled={props.pending}
            >
              <Checkbox.Control />
              <Checkbox.Label>
                {t('create.taskTemplateShareWithTeam', { name: team().name })}
              </Checkbox.Label>
            </Checkbox>
            <Show when={shared()}>
              <p class="text-xs text-ink-muted">
                {t('create.taskTemplateTeamPermissions')}
              </p>
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.error}>
        <p role="alert" class="text-sm text-failure-ink">
          {props.error}
        </p>
      </Show>
      <div class="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={props.pending}
          onClick={() => props.onOpenChange(false)}
        >
          {t('create.taskTemplateCancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={props.pending}
          disabled={!props.canSave || !name().trim() || props.pending}
        >
          {props.pending
            ? t('create.taskTemplateSaving')
            : t('create.taskTemplateSave')}
        </Button>
      </div>
    </form>
  );
}
