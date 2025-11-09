import { IconButton } from '@core/component/IconButton';
import { UserIcon } from '@core/component/UserIcon';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { idToDisplayName } from '@core/user';
import { formatDate } from '@core/util/date';
import Check from '@phosphor-icons/core/regular/check.svg?component-solid';
import NotePencil from '@phosphor-icons/core/regular/note-pencil.svg?component-solid';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { type ParentProps, Show, useContext } from 'solid-js';
import { CommentsContext } from './Thread';

// SCUFFED: how should we define these tag colors?
const NewTag = () => {
  return (
    <div class="py-0.5 px-1.5 rounded ml-1 bg-amber-100 text-amber-700 text-xs">
      New
    </div>
  );
};

export enum Color {
  gray,
  red,
  amber,
  yellow,
  green,
  teal,
  sky,
  blue,
  indigo,
  purple,
  pink,
  rose,
}

export function MessageRow(
  props: ParentProps<{
    authorId: string | null;
    date: Date;
    hideBottomMargin?: boolean;
    nameSlot?: any;
    isActive: boolean;
  }>
) {
  return (
    <MessageRowUI
      authorId={props.authorId ?? 'Macro User'}
      date={props.date}
      hideBottomMargin={props.hideBottomMargin}
      nameSlot={props.nameSlot}
      isActive={props.isActive}
      children={props.children}
    />
  );
}

export function MessageRowUI(
  props: ParentProps<{
    authorId: string;
    date: Date;
    hideBottomMargin?: boolean;
    nameSlot?: any;
    hideBubble?: boolean;
    isActive: boolean;
  }>
) {
  const displayName = () => {
    return idToDisplayName(props.authorId);
  };
  return (
    <div
      class="flex w-full items-start justify-between group relative font-mono"
      classList={{
        'mb-3': !props.hideBottomMargin,
      }}
    >
      <div
        class={`flex w-full flex-row gap-2 ${props.isActive ? 'truncate' : ''} group-hover:truncate`}
      >
        {!props.hideBubble && (
          <div
            class={`w-4 h-4 relative flex items-center justify-center flex-shrink-0 rounded-[2px]`}
          >
            <div class="absolute">
              <UserIcon
                size="xs"
                suppressClick={true}
                id={props.authorId}
                isDeleted={false}
              />
            </div>
          </div>
        )}
        <div class="text-xs text-ink truncate grow-1">{displayName()}</div>
        <div class="text-xs text-ink-muted">
          {formatDate(props.date.valueOf())}
        </div>
      </div>
      <Show when={props.children}>
        <div
          class={`items-center space-x-1 ml-2 flex ${isMobileWidth() && props.isActive ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100`}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}

export function MessageTopRow(props: {
  authorId: string | null;
  date: Date;
  deleteMessage?: () => void;
  enableEditing?: () => void;
  hideBottomMargin?: boolean;
  isNew: boolean;
  isResolved: boolean;
  toggleResolve?: () => void;
  isOwned: boolean;
  isActive: boolean;
  isEditing?: boolean;
}) {
  const { canComment, isDocumentOwner } = useContext(CommentsContext);

  return (
    <MessageRow
      nameSlot={props.isNew && <NewTag />}
      authorId={props.authorId}
      date={props.date}
      hideBottomMargin={props.hideBottomMargin}
      isActive={props.isActive}
    >
      <div class="absolute top-1 right-1 flex flex-row bg-menu border-1 border-edge z-1">
        <Show when={canComment()}>
          <Show when={props.isOwned}>
            {props.toggleResolve && (
              <IconButton
                tooltip={{ label: 'Resolve Comment' }}
                icon={Check}
                theme={props.isResolved ? 'accent' : 'clear'}
                on:click={props.toggleResolve}
              />
            )}
            {props.enableEditing && (
              <IconButton
                tooltip={{ label: 'Edit Comment' }}
                theme="clear"
                icon={NotePencil}
                on:click={props.enableEditing}
              />
            )}
          </Show>
          <Show when={!props.isEditing && (props.isOwned || isDocumentOwner())}>
            <IconButton
              tooltip={{ label: 'Delete Comment' }}
              theme="clear"
              icon={Trash}
              on:click={props.deleteMessage}
            />
          </Show>
        </Show>
      </div>
    </MessageRow>
  );
}
