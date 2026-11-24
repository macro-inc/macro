import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { createWritableMemo } from '@solid-primitives/memo';
import { Dropdown, Tooltip } from '@ui';
import { batch, For, on, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { recurrencePresetsFor } from '../../../utils/recurrence';
import { CustomRecurrenceDialog } from './CustomRecurrenceDialog';

export function ComposerRecurrence(props: { size?: 'sm' | 'md' } = {}) {
  const model = useCalendarComposer();
  const when = model.when;
  const reason = model.recurrenceScopeReason;
  const disabled = () =>
    model.fieldIsDisabled('recurrence') || Boolean(reason());
  // Permission changes close the dialog and discard its uncommitted draft.
  const [customOpen, setCustomOpen] = createWritableMemo(
    on(disabled, () => false)
  );
  const customSeed = () =>
    recurrencePresetsFor(model.controller.startForRecurrence()).find(
      (preset) => preset.id === model.controller.recurrenceChoice()
    )?.config ?? model.controller.customConfig();
  return (
    <>
      <Dropdown
        placement="bottom-start"
        open={when.state.active === 'repeat'}
        onOpenChange={(open) => {
          if (open) when.open('repeat');
          else when.close('repeat');
        }}
      >
        <Tooltip label={reason() ?? ''} disabled={!reason()}>
          <Dropdown.Trigger
            variant="value"
            finish="flat"
            size={props.size ?? 'sm'}
            aria-label={t('calendar.composerRepeats')}
            aria-readonly={Boolean(reason()) || undefined}
            aria-describedby={model.recurrenceDescribedBy()}
            disabled={model.fieldIsDisabled('recurrence')}
          >
            <span>{model.controller.selectedRecurrenceOption().label}</span>
            <CaretDownIcon class="size-3.5" />
          </Dropdown.Trigger>
        </Tooltip>
        <Dropdown.Content portalScope="local" class="min-w-48">
          <Dropdown.Group>
            <Dropdown.RadioGroup
              value={model.controller.recurrenceChoice()}
              onChange={(value) => {
                if (!reason()) model.controller.changeRecurrenceChoice(value);
              }}
            >
              <For
                each={model.controller
                  .recurrenceOptions()
                  .filter((option) => option.value !== 'custom')}
              >
                {(option) => (
                  <Dropdown.RadioItem
                    value={option.value}
                    disabled={Boolean(reason())}
                    closeOnSelect
                  >
                    <span class="flex-1">{option.label}</span>
                    <Dropdown.ItemIndicator />
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
            <Dropdown.Item
              disabled={disabled()}
              onSelect={() => setCustomOpen(true)}
            >
              {t('calendar.customRepeat')}
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <Show when={customOpen() && !disabled()}>
        <CustomRecurrenceDialog
          value={customSeed()}
          start={model.controller.startForRecurrence()}
          allDay={model.state().allDay}
          disabled={disabled()}
          onClose={() => setCustomOpen(false)}
          onChange={(config) =>
            batch(() => {
              model.controller.changeRecurrenceChoice('custom');
              model.controller.setCustomConfig(config);
            })
          }
        />
      </Show>
    </>
  );
}
