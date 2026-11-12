import { ViewSidebar } from '@app/components/view-shell';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { PASSWORD_KINDS } from '../core/kinds';
import type { PasswordKind } from '../core/types';
import { KIND_ICONS } from './kind-icon';

/** The kind is chosen here, before any editor opens. */
export function NewItemMenu(props: {
  presentation: 'sidebar' | 'toolbar';
  destination: string;
  onCreate: (kind: PasswordKind) => void;
  onFolder: () => void;
}) {
  const label = () =>
    t('passwords.newItemOrFolder', { destination: props.destination });
  return (
    <Dropdown
      placement={
        props.presentation === 'toolbar' ? 'bottom-end' : 'bottom-start'
      }
    >
      <Show
        when={!isTouchDevice()}
        fallback={
          <Dropdown.Trigger as={ViewSidebar.Action} aria-label={label()}>
            <ViewSidebar.Icon>
              <PlusIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">{t('passwords.new')}</span>
            <ViewSidebar.Trailing>
              <CaretDownIcon class="size-3 shrink-0" />
            </ViewSidebar.Trailing>
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          as={ViewCreateButton}
          presentation={props.presentation}
          menu
          aria-label={label()}
        />
      </Show>
      <Dropdown.Content class="min-w-56 max-w-[calc(100vw-2rem)]">
        <Dropdown.Group>
          <Dropdown.GroupLabel class="min-w-0 gap-1.5">
            <span class="shrink-0">{t('passwords.createIn')}</span>
            <FolderIcon aria-hidden="true" class="size-3.5 shrink-0" />
            <span class="min-w-0 truncate font-medium text-ink-muted">
              {props.destination}
            </span>
          </Dropdown.GroupLabel>
          <For each={PASSWORD_KINDS}>
            {(kind) => (
              <Dropdown.Item onSelect={() => props.onCreate(kind)}>
                <Dynamic component={KIND_ICONS[kind]} class="size-4 shrink-0" />
                <span class="truncate">{t(`passwords.${kind}`)}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.Item onSelect={props.onFolder}>
            <FolderPlusIcon class="size-4 shrink-0" />
            <span class="truncate">{t('passwords.folder')}</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
