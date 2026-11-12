import { t } from '@app/lib/i18n';
import { TaskStatusIcon } from '@core/component/TaskStatusIcon';
import { Match, Switch } from 'solid-js';
import type { PropertySaveFn } from '../core/context';
import { PropertyEmptyIcon } from '../extractors/PropertyEmpty';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';
import { Property } from '../property';
import type { Property as PropertyValue } from '../types';
import { hasValue } from '../utils/typeGuards';

/** Shared leading Status/Priority editor for task and project rows. */
export function PropertyIconControl(props: {
  property: PropertyValue;
  canEdit: boolean;
  onSave: PropertySaveFn;
  completed?: boolean;
}) {
  const isStatus = () =>
    props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS;
  return (
    <Property.Root
      property={props.property}
      class="shrink-0"
      canEdit={props.canEdit}
      onSave={props.onSave}
    >
      {(shown) => {
        const statusId = () => {
          const property = shown();
          return property.valueType === 'SELECT_STRING'
            ? property.value?.[0]
            : undefined;
        };
        return (
          <>
            <Property.Tooltip property={shown()}>
              <Property.Pill
                aria-label={
                  isStatus()
                    ? t('common.changeStatus')
                    : t('common.changePriority')
                }
                data-blocks-navigation
                stopPropagation={props.canEdit}
                class="flex size-6 shrink-0 items-center justify-center rounded-full border-0 touch:size-9"
              >
                <Switch>
                  <Match when={isStatus()}>
                    <TaskStatusIcon
                      statusId={statusId()}
                      completed={props.completed ?? false}
                      size="xs"
                      decorative
                      class="size-4.5"
                    />
                  </Match>
                  <Match when={hasValue(shown())}>
                    <Property.Icon
                      property={shown()}
                      class="size-4 shrink-0 mobile:size-5"
                    />
                  </Match>
                  <Match when={true}>
                    <PropertyEmptyIcon
                      propertyDefinitionId={props.property.propertyDefinitionId}
                      class="size-4 shrink-0 text-ink-extra-muted mobile:size-5"
                    />
                  </Match>
                </Switch>
              </Property.Pill>
            </Property.Tooltip>
            <Property.PopoverEditor />
          </>
        );
      }}
    </Property.Root>
  );
}
