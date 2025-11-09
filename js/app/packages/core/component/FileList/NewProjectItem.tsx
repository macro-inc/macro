import { EditableLabel } from '@core/component/Editable';
import { EntityIcon, ICON_SIZE_CLASSES } from '@core/component/EntityIcon';
import {
  FILE_LIST_ROW_HEIGHT,
  type FileListSize,
  TEXT_SIZE_CLASSES,
} from '@core/component/FileList/constants';
import { Caret, ExplorerSpacer } from '@core/component/FileList/ExplorerSpacer';
import {
  ActionColumn,
  NameColumn,
  OwnerColumn,
  TimeColumn,
} from '@core/component/FileList/ListViewColumns';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { UserIcon } from '@core/component/UserIcon';
import { formatRelativeDate } from '@core/util/time';
import Pin from '@icon/regular/push-pin.svg?component-solid';
import { useUserId } from '@service-gql/client';
import { Show } from 'solid-js';

type EditableItemProps = {
  onSubmitEdit: (edit: string) => void;
  onCancelEdit: () => void;
  name: string;
  size: FileListSize;
};

function EditingItem(props: EditableItemProps) {
  return (
    <EditableLabel
      handleSubmitEdit={props.onSubmitEdit}
      handleCancelEdit={props.onCancelEdit}
      labelText={props.name}
      size={props.size}
      placeholder="New folder"
    />
  );
}

export type NewProjectItemProps = {
  size: FileListSize;
  onSubmitEdit: (name: string) => void;
  onCancelEdit: () => void;
  depth?: number;
  hideOwner?: boolean;
  hideDate?: boolean;
  hideAction?: boolean;
};

export function NewProjectItem(props: NewProjectItemProps) {
  const userId = useUserId();

  return (
    <div
      class={`flex items-center w-full justify-between ${FILE_LIST_ROW_HEIGHT[props.size]} `}
    >
      <NameColumn>
        <div class="group/project flex items-center h-full">
          <ExplorerSpacer depth={props.depth} size={props.size} />
          <Caret isExpanded={false} size={props.size} />
          <EntityIcon targetType="project" size={props.size} />
        </div>
        <EditingItem
          onSubmitEdit={props.onSubmitEdit}
          onCancelEdit={props.onCancelEdit}
          name=""
          size={props.size}
        />
      </NameColumn>
      <Show when={!props.hideOwner}>
        <OwnerColumn>
          <UserIcon id={userId() ?? ''} size={props.size} isDeleted={false} />
          <TruncatedText size={props.size}>Me</TruncatedText>
        </OwnerColumn>
      </Show>
      <Show when={!props.hideDate}>
        <TimeColumn>
          <div class={`px-2 ${TEXT_SIZE_CLASSES[props.size]}`}>
            {formatRelativeDate(new Date().toISOString())}
          </div>
        </TimeColumn>
      </Show>
      <Show when={!props.hideAction}>
        <ActionColumn>
          <div class="invisible">
            <Pin class={`${ICON_SIZE_CLASSES[props.size]}`} />
          </div>
        </ActionColumn>
      </Show>
    </div>
  );
}
