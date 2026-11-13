import { t } from '@app/lib/i18n';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import { Dropdown, ToggleSwitch } from '@ui';
import { Show } from 'solid-js';

/**
 * One stack in the settings list: its name, a line saying what it does, the
 * switch that turns it on or off, and its menu.
 */
export function StackRow(props: {
  name: string;
  summary: string;
  enabled: boolean;
  /**
   * A stack the editor can show. Others say why Edit is off, and can still be
   * switched and deleted.
   */
  editable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div class="flex min-h-[60px] items-center gap-3 px-6 py-3.5">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-sm text-ink">{props.name}</span>
        <span class="text-xs leading-5 text-ink-muted">{props.summary}</span>
        <Show when={!props.editable}>
          <span class="text-xs leading-5 text-ink-muted">
            {t('notificationStacks.notEditable')}
          </span>
        </Show>
      </div>
      <ToggleSwitch
        size="md"
        class="touch:min-h-11 touch:min-w-11 touch:justify-center"
        label={t('notificationStacks.enabledLabel', { name: props.name })}
        labelClass="sr-only"
        checked={props.enabled}
        onChange={props.onEnabledChange}
      />
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          aria-label={t('notificationStacks.moreActions', { name: props.name })}
          variant="ghost"
          size="icon-md"
          class="touch:min-h-11 touch:min-w-11"
        >
          <DotsThreeIcon class="size-5" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-44 max-w-72">
          <Dropdown.Group>
            <Dropdown.Item disabled={!props.editable} onSelect={props.onEdit}>
              {t('notificationStacks.edit')}
            </Dropdown.Item>
            <Dropdown.Item
              disabled={!props.canMoveUp}
              onSelect={props.onMoveUp}
            >
              {t('notificationStacks.moveUp')}
            </Dropdown.Item>
            <Dropdown.Item
              disabled={!props.canMoveDown}
              onSelect={props.onMoveDown}
            >
              {t('notificationStacks.moveDown')}
            </Dropdown.Item>
            <Dropdown.Item
              class="text-failure data-highlighted:bg-failure-bg"
              onSelect={props.onDelete}
            >
              {t('notificationStacks.delete')}
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
