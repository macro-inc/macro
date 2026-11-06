import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { onElementConnect } from '@core/util/onElementConnect';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import InfoIcon from '@icon/system/regular/info.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Dropdown, SingleSelectCheck, TextField, Tooltip } from '@ui';
import { createSignal, Show } from 'solid-js';

function TemplateInfo(props: { description: string }) {
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  let restoreTriggerFocus = true;
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Tooltip.Root placement="top">
          <Tooltip.Trigger
            as={Button}
            variant="ghost"
            size="icon-md"
            aria-label={t('create.taskTemplateInfo')}
          >
            <InfoIcon class="size-4 text-ink-muted" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="max-w-72">
              {props.description}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      }
    >
      <Popover
        placement="top-end"
        gutter={8}
        modal={false}
        onOpenChange={(open) => {
          if (open) restoreTriggerFocus = true;
        }}
      >
        <Popover.Trigger
          as={Button}
          ref={setTrigger}
          variant="ghost"
          size="icon-md"
          aria-label={t('create.taskTemplateInfo')}
        >
          <InfoIcon class="size-4 text-ink-muted" />
        </Popover.Trigger>
        <Popover.Portal
          mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
        >
          <Popover.Content
            onInteractOutside={() => {
              restoreTriggerFocus = false;
            }}
            onCloseAutoFocus={(event) => {
              if (!restoreTriggerFocus) return;
              event.preventDefault();
              trigger()?.focus({ preventScroll: true });
            }}
            class="menu-surface z-action-menu w-72 max-w-[min(18rem,var(--kb-popper-content-available-width),calc(100vw-2rem))] p-3 text-xs leading-relaxed whitespace-normal break-words outline-none"
          >
            <Popover.Title class="sr-only">
              {t('create.taskTemplateInfo')}
            </Popover.Title>
            <Popover.Description>{props.description}</Popover.Description>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </Show>
  );
}

/** Compact template metadata above the composer's ordinary task fields. */
export function TemplateDetails(props: {
  name: string;
  teamId: string | null;
  team?: { id: string; name: string };
  editing: boolean;
  pending: boolean;
  onNameChange(value: string): void;
  onTeamIdChange(value: string | null): void;
}) {
  const visibility = () =>
    props.teamId
      ? t('create.taskTemplateTeam')
      : t('create.taskTemplatePersonal');
  const description = () => {
    const hint = props.editing
      ? t('create.taskTemplateEditComposerHint')
      : t('create.taskTemplateComposerHint');
    return props.teamId
      ? `${hint} ${t('create.taskTemplateTeamPermissions')}`
      : hint;
  };
  return (
    <div class="flex min-w-0 shrink-0 items-center gap-2">
      <TextField
        class="min-w-0 flex-1"
        value={props.name}
        onChange={props.onNameChange}
        disabled={props.pending}
        required
      >
        <TextField.Label class="sr-only">
          {t('create.taskTemplateName')}
        </TextField.Label>
        <TextField.Input
          ref={(element) =>
            onElementConnect(element, () => {
              if (!isTouchDevice()) element.focus();
            })
          }
          placeholder={t('create.taskTemplateNamePlaceholder')}
          maxLength={120}
        />
      </TextField>
      <Show
        when={!props.editing && props.team}
        fallback={
          <span class="shrink-0 text-sm text-ink-muted">{visibility()}</span>
        }
      >
        {(team) => (
          <Dropdown>
            <Dropdown.Trigger
              variant="secondary"
              size="md"
              disabled={props.pending}
              aria-label={t('create.taskTemplateVisibility')}
            >
              {visibility()}
              <CaretDownIcon class="size-3 shrink-0" />
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.RadioGroup
                value={props.teamId ?? 'personal'}
                onChange={(value) =>
                  props.onTeamIdChange(value === 'personal' ? null : value)
                }
              >
                <Dropdown.RadioItem value="personal">
                  <span class="min-w-0 flex-1">
                    {t('create.taskTemplatePersonal')}
                  </span>
                  <SingleSelectCheck active={!props.teamId} />
                </Dropdown.RadioItem>
                <Dropdown.RadioItem value={team().id}>
                  <span class="min-w-0 flex-1 truncate">{team().name}</span>
                  <SingleSelectCheck active={props.teamId === team().id} />
                </Dropdown.RadioItem>
              </Dropdown.RadioGroup>
            </Dropdown.Content>
          </Dropdown>
        )}
      </Show>
      <TemplateInfo description={description()} />
    </div>
  );
}
