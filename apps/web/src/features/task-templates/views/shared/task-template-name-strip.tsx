import { t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CopyIcon from '@icon/system/regular/copy.svg';
import { Avatar, cn, Input, ToggleSwitch, Tooltip } from '@ui';
import { inputOutlineFocusClasses } from '@ui/components/Input';
import { Show } from 'solid-js';
import type { TaskComposerController } from '../../../task-composer/primitives/task-composer';

/** Template identity and immutable ownership, separate from the task defaults. */
export function TaskTemplateNameStrip(props: {
  composer: Pick<
    TaskComposerController,
    | 'templateSelection'
    | 'team'
    | 'isTemplateMode'
    | 'isSavingTemplate'
    | 'setTemplateName'
    | 'setTemplateTeamId'
  >;
}) {
  const selection = () => props.composer.templateSelection();
  const name = () => {
    const current = selection();
    return current.kind === 'new' || current.kind === 'editing'
      ? current.name
      : '';
  };
  const teamId = () => {
    const current = selection();
    if (current.kind === 'new') return current.teamId;
    if (current.kind === 'editing') return current.template.teamId;
    return null;
  };
  const teamName = () =>
    props.composer.team()?.name ?? t('create.taskTemplateTeam');
  const teamIdentity = () => (
    <>
      <Avatar size="sm" shape="square">
        <Avatar.Fallback>
          {teamName().slice(0, 1).toUpperCase()}
        </Avatar.Fallback>
      </Avatar>
      <span class="min-w-0 truncate">{teamName()}</span>
    </>
  );
  return (
    <Show when={props.composer.isTemplateMode()}>
      <div class="mb-4 flex min-w-0 shrink-0 items-center gap-3 mobile:flex-wrap">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <CopyIcon class="size-4 shrink-0 text-ink-muted" />
          <Input
            variant="bare"
            size="lg"
            ref={(input) =>
              onElementConnect(input, () => {
                if (selection().kind === 'new') input.focus();
              })
            }
            class={cn(
              'ph-no-capture truncate px-0 font-semibold',
              inputOutlineFocusClasses
            )}
            aria-label={t('create.taskTemplateName')}
            placeholder={t('create.taskTemplateNamePlaceholder')}
            autocomplete="off"
            data-1p-ignore
            value={name()}
            disabled={props.composer.isSavingTemplate()}
            onInput={(event) =>
              props.composer.setTemplateName(event.currentTarget.value)
            }
          />
        </div>
        <Show
          when={
            (selection().kind === 'new' && props.composer.team()) || teamId()
          }
        >
          <div class="flex min-w-0 max-w-1/2 shrink-0 items-center mobile:max-w-full mobile:basis-full">
            <Show
              when={selection().kind === 'new'}
              fallback={
                <Tooltip
                  label={teamName()}
                  class="min-w-0 flex items-center gap-2 text-xs"
                >
                  {teamIdentity()}
                </Tooltip>
              }
            >
              <Show when={props.composer.team()}>
                {(team) => (
                  <ToggleSwitch
                    checked={Boolean(teamId())}
                    onChange={(checked) =>
                      props.composer.setTemplateTeamId(
                        checked ? team().id : null
                      )
                    }
                    disabled={props.composer.isSavingTemplate()}
                    label={t('create.taskTemplateShareVisibility')}
                    labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
                  />
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
