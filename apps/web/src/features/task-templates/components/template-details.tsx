import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { onElementConnect } from '@core/util/onElementConnect';
import { Checkbox, TextField } from '@ui';
import { Show } from 'solid-js';

/** Template metadata accompanies the composer's existing fields and description. */
export function TemplateDetails(props: {
  name: string;
  teamId: string | null;
  team?: { id: string; name: string };
  editing: boolean;
  pending: boolean;
  onNameChange(value: string): void;
  onTeamIdChange(value: string | null): void;
}) {
  return (
    <div class="flex flex-col gap-3 border-b border-edge-muted pb-4">
      <TextField
        value={props.name}
        onChange={props.onNameChange}
        disabled={props.pending}
        required
      >
        <TextField.Label>{t('create.taskTemplateName')}</TextField.Label>
        <TextField.Input
          ref={(element) =>
            onElementConnect(element, () => {
              if (!isTouchDevice()) element.focus();
            })
          }
          placeholder={t('create.taskTemplateNamePlaceholder')}
          maxLength={120}
        />
        <TextField.Description>
          {props.editing
            ? t('create.taskTemplateEditComposerHint')
            : t('create.taskTemplateComposerHint')}
        </TextField.Description>
      </TextField>
      <Show when={!props.editing && props.team}>
        {(team) => (
          <div class="flex flex-col gap-2">
            <Checkbox
              checked={Boolean(props.teamId)}
              onChange={(shared) =>
                props.onTeamIdChange(shared ? team().id : null)
              }
              disabled={props.pending}
            >
              <Checkbox.Control />
              <Checkbox.Label>
                {t('create.taskTemplateShareWithTeam', { name: team().name })}
              </Checkbox.Label>
            </Checkbox>
            <Show when={props.teamId}>
              <p class="text-xs text-ink-muted">
                {t('create.taskTemplateTeamPermissions')}
              </p>
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.editing}>
        <p class="text-xs text-ink-muted">
          {props.teamId
            ? t('create.taskTemplateTeam')
            : t('create.taskTemplatePersonal')}
          <Show when={props.teamId}>
            {' '}
            · {t('create.taskTemplateTeamPermissions')}
          </Show>
        </p>
      </Show>
    </div>
  );
}
