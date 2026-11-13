import { NarrowRowGrid } from '@app/features/entity/composed/list-entity/narrow-row-grid';
import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import { Entity } from '@entity';
import { Property as PropertyControl } from '@property';
import { PropertyIconControl } from '@property/component/PropertyIconControl';
import { PropertyEmptyIcon } from '@property/extractors/PropertyEmpty';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { hasValue } from '@property/utils';
import { Show } from 'solid-js';
import { canEditProject } from '../../core/project';
import type { ProjectRowProps } from '../../project-row';
import {
  ProjectRowColumns,
  ProjectRowName,
} from '../shared/project-row-content';

export function MobileProjectRow(props: ProjectRowProps) {
  const canEdit = () => canEditProject(props.row.project);
  const propertyFor = (id: string) =>
    props.row.properties.find(
      (property) => property.propertyDefinitionId === id
    ) ??
    props.definitions?.find((property) => property.propertyDefinitionId === id);

  return (
    <Show when={isMobile()} fallback={<ProjectRowColumns {...props} />}>
      <NarrowRowGrid variant="compact">
        <Entity.Slot placement="indicator" />
        <Entity.Slot placement="title" class="min-w-0 font-medium">
          <ProjectRowName row={props.row} />
        </Entity.Slot>
        <Entity.Slot placement="timestamp" class="flex items-center gap-1">
          <Show when={propertyFor(SYSTEM_PROPERTY_IDS.STATUS)}>
            {(property) => (
              <PropertyIconControl
                property={property()}
                canEdit={canEdit()}
                onSave={props.onSave}
              />
            )}
          </Show>
          <Show when={propertyFor(SYSTEM_PROPERTY_IDS.PRIORITY)}>
            {(property) => (
              <PropertyIconControl
                property={property()}
                canEdit={canEdit()}
                onSave={props.onSave}
              />
            )}
          </Show>
          <Show when={propertyFor(SYSTEM_PROPERTY_IDS.ASSIGNEES)}>
            {(property) => (
              <PropertyControl.Root
                property={property()}
                canEdit={canEdit()}
                onSave={props.onSave}
              >
                {(shown) => (
                  <>
                    <PropertyControl.Pill
                      aria-label={
                        hasValue(shown())
                          ? t('entityActions.setAssignee')
                          : t('viewMenus.unassigned')
                      }
                      data-blocks-navigation
                      stopPropagation={canEdit()}
                      class="flex size-9 items-center justify-center rounded-full border-0"
                    >
                      <Show
                        when={hasValue(shown())}
                        fallback={
                          <PropertyEmptyIcon
                            propertyDefinitionId={SYSTEM_PROPERTY_IDS.ASSIGNEES}
                            class="size-5"
                            muted
                          />
                        }
                      >
                        <PropertyControl.Icon
                          property={shown()}
                          class="size-5"
                        />
                      </Show>
                    </PropertyControl.Pill>
                    <PropertyControl.PopoverEditor />
                  </>
                )}
              </PropertyControl.Root>
            )}
          </Show>
        </Entity.Slot>
      </NarrowRowGrid>
    </Show>
  );
}
