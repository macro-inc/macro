import { ViewSidebar } from '@app/components/view-shell';
import { CreateMenuItem } from '@app/components/view-shell/CreateMenuItem';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TableIcon from '@icon/system/regular/table.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

/** Sidebar create action for every CRM record type. */
export function CrmCreateMenu(props: {
  presentation?: 'sidebar' | 'toolbar';
  onCreateCompany(): void;
  onCreateContact(): void;
  /** Omitted while pipelines are unavailable to the viewer. */
  pipeline?: { disabled: boolean; onCreate(): void };
}) {
  return (
    <Dropdown
      placement={
        props.presentation === 'toolbar' ? 'bottom-end' : 'bottom-start'
      }
    >
      <Show
        when={!isTouchDevice()}
        fallback={
          <Dropdown.Trigger
            as={ViewSidebar.Action}
            aria-label={t('create.createCrmRecord')}
          >
            <ViewSidebar.Icon>
              <PlusIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">{t('create.new')}</span>
            <ViewSidebar.Trailing>
              <CaretDownIcon class="size-3 shrink-0" />
            </ViewSidebar.Trailing>
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          as={ViewCreateButton}
          presentation={props.presentation ?? 'sidebar'}
          aria-label={t('create.createCrmRecord')}
          menu
        />
      </Show>
      <Dropdown.Content class="w-80 max-w-[calc(100vw-2rem)]">
        <Dropdown.Group>
          <CreateMenuItem
            icon={BuildingsIcon}
            title={t('create.companyLabel')}
            description={t('create.guideCompany')}
            onSelect={props.onCreateCompany}
          />
          <CreateMenuItem
            icon={UserIcon}
            title={t('create.contactLabel')}
            description={t('create.guideContact')}
            onSelect={props.onCreateContact}
          />
          <Show when={props.pipeline}>
            {(pipeline) => (
              <CreateMenuItem
                icon={TableIcon}
                title={t('create.pipelineLabel')}
                description={t('create.guidePipeline')}
                disabled={pipeline().disabled}
                onSelect={() => pipeline().onCreate()}
              />
            )}
          </Show>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
