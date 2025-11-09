import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { IconButton } from '@core/component/IconButton';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import type { SortPair } from '@core/util/sort';
import ArrowDownIcon from '@icon/regular/arrow-down.svg?component-solid';
import ArrowUpIcon from '@icon/regular/arrow-up.svg?component-solid';
import CaretDownIcon from '@icon/regular/caret-down.svg?component-solid';
import ThreeDotsIcon from '@icon/regular/dots-three.svg?component-solid';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import {
  type Accessor,
  createSignal,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import { ScopedPortal } from '../ScopedPortal';
import { Tooltip } from '../Tooltip';
import {
  ActionColumn,
  NameColumn,
  OwnerColumn,
  TimeColumn,
} from './ListViewColumns';

type ListViewHeaderProps = {
  parentId?: string;
  fileSort: Accessor<SortPair>;
  setFileSort: Setter<SortPair>;
  showProjectsFirst: boolean;
  setShowProjectsFirst: Setter<boolean>;
  showTrash?: boolean;
  setShowTrash?: Setter<boolean>;
  hideOwner?: boolean;
  hideAction?: boolean;
};

export function ListViewHeader(props: ListViewHeaderProps) {
  const setShowProjectsFirst = props.setShowProjectsFirst;
  const setShowTrash = props.setShowTrash;
  const [showTimeDropdown, setShowTimeDropdown] = createSignal(false);

  onMount(() => {
    if (props.parentId === 'trash') {
      props.setFileSort(['deletedAt', 'desc']);
    }
  });

  return (
    <div class="flex items-center justify-between text-sm font-medium pt-4 font-sans">
      <NameColumn>
        <span
          class="hover:bg-hover hover-transition-bg rounded-md px-2 py-1"
          onClick={() => {
            props.setFileSort((prev) => {
              if (prev[0] === 'name') {
                return ['name', prev[1] === 'asc' ? 'desc' : 'asc'];
              }
              return ['name', 'asc'];
            });
          }}
        >
          Name
        </span>
        <Show when={props.fileSort()[0] === 'name'}>
          <IconButton
            icon={props.fileSort()[1] === 'asc' ? ArrowUpIcon : ArrowDownIcon}
            iconSize={16}
            onClick={() => {
              props.setFileSort((prev) => {
                return ['name', prev[1] === 'asc' ? 'desc' : 'asc'];
              });
            }}
          />
        </Show>
      </NameColumn>
      <Show when={!props.hideOwner}>
        <OwnerColumn>
          <span
            class="hover:bg-hover hover-transition-bg rounded-md px-2 py-1"
            onClick={() => {
              props.setFileSort((prev) => {
                if (prev[0] === 'owner') {
                  return ['owner', prev[1] === 'asc' ? 'desc' : 'asc'];
                }
                return ['owner', 'asc'];
              });
            }}
          >
            Owner
          </span>
          <Show when={props.fileSort()[0] === 'owner'}>
            <IconButton
              icon={props.fileSort()[1] === 'asc' ? ArrowUpIcon : ArrowDownIcon}
              iconSize={16}
              onClick={() => {
                props.setFileSort((prev) => {
                  return ['owner', prev[1] === 'asc' ? 'desc' : 'asc'];
                });
              }}
            />
          </Show>
        </OwnerColumn>
      </Show>
      <TimeColumn>
        <DropdownMenu
          open={showTimeDropdown()}
          onOpenChange={setShowTimeDropdown}
        >
          <DropdownMenu.Trigger class="flex items-center gap-1 hover:bg-hover hover-transition-bg rounded-md px-2 py-1 max-w-3/4">
            <Tooltip
              tooltip={
                props.fileSort()[0] === 'createdAt'
                  ? 'Created'
                  : props.fileSort()[0] === 'deletedAt'
                    ? 'Date trashed'
                    : 'Last modified'
              }
              class="flex gap-1 max-w-full"
            >
              <TruncatedText size="sm">
                <span>
                  {props.fileSort()[0] === 'createdAt'
                    ? 'Created'
                    : props.fileSort()[0] === 'deletedAt'
                      ? 'Date trashed'
                      : 'Last modified'}
                </span>
              </TruncatedText>
              <CaretDownIcon class="w-4 h-4" />
            </Tooltip>
          </DropdownMenu.Trigger>
          <ScopedPortal show={showTimeDropdown()} scope="local">
            <DropdownMenuContent>
              <MenuItem
                text="Last modified"
                onClick={() =>
                  props.setFileSort((prev) => {
                    return ['updatedAt', prev[1] === 'asc' ? 'asc' : 'desc'];
                  })
                }
              />
              <MenuItem
                text="Created"
                onClick={() =>
                  props.setFileSort((prev) => {
                    return ['createdAt', prev[1] === 'asc' ? 'asc' : 'desc'];
                  })
                }
              />
              <Show when={props.parentId === 'trash'}>
                <MenuItem
                  text="Date trashed"
                  onClick={() =>
                    props.setFileSort((prev) => {
                      return ['deletedAt', prev[1] === 'asc' ? 'asc' : 'desc'];
                    })
                  }
                />
              </Show>
            </DropdownMenuContent>
          </ScopedPortal>
        </DropdownMenu>
        <Show
          when={
            props.fileSort()[0] === 'updatedAt' ||
            props.fileSort()[0] === 'createdAt' ||
            props.fileSort()[0] === 'deletedAt'
          }
        >
          <IconButton
            icon={props.fileSort()[1] === 'asc' ? ArrowUpIcon : ArrowDownIcon}
            iconSize={16}
            onClick={() => {
              props.setFileSort((prev) => {
                return [prev[0], prev[1] === 'asc' ? 'desc' : 'asc'];
              });
            }}
          />
        </Show>
      </TimeColumn>
      <ActionColumn class="pr-4">
        <DropdownMenu>
          <DropdownMenu.Trigger disabled={props.hideAction}>
            <ThreeDotsIcon
              class={`size-8 hover:bg-hover hover-transition-bg rounded-full p-1 ${props.hideAction ? 'hidden' : ''}`}
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <MenuItem
                text="Show folders first"
                selectorType="checkbox"
                checked={props.showProjectsFirst}
                onClick={() => {
                  setShowProjectsFirst((prev) => !prev);
                }}
              />
              <Show
                when={
                  props.parentId === 'root' && props.setShowTrash !== undefined
                }
              >
                <MenuItem
                  text="Show trash"
                  selectorType="checkbox"
                  checked={props.showTrash ?? false}
                  onClick={() => {
                    setShowTrash?.((prev) => !prev);
                  }}
                />
              </Show>
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </ActionColumn>
    </div>
  );
}
