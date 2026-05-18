import { UserIcon } from '@core/component/UserIcon';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { idToDisplayName } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import Check from '@icon/check.svg';
import Link from '@icon/link.svg';
import NotePencil from '@icon/note-pencil.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { Button, cn } from '@ui';
import { type ParentProps, Show, useContext } from 'solid-js';
import { CommentsContext } from './Thread';

// SCUFFED: how should we define these tag colors?
const NewTag = () => {
  return (
    <div class="py-0.5 px-1.5 rounded ml-1 bg-[oklch(0.962_0.059_95.617)] text-[oklch(0.555_0.163_48.998)] text-xs">
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
    date?: DateValue | null;
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
    date?: DateValue | null;
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
      class="flex w-full items-start justify-between group relative text-ink-extra-muted"
      classList={{
        'mb-3': !props.hideBottomMargin,
      }}
    >
      <div
        class={cn(
          'flex w-full flex-row gap-2 group-hover:truncate',
          props.isActive && 'truncate'
        )}
      >
        {!props.hideBubble && (
          <div
            class={`size-4 relative flex items-center justify-center shrink-0 rounded-xs`}
          >
            <UserIcon
              size="sm"
              suppressClick={true}
              id={props.authorId}
              isDeleted={false}
            />
          </div>
        )}
        <div class="text-xs text-ink truncate grow">{displayName()}</div>
        <Show when={props.date}>
          <div class="text-xs text-ink-muted">{formatDate(props.date)}</div>
        </Show>
      </div>
      <Show when={props.children}>
        <div
          class={cn(
            'items-center space-x-1 ml-2 flex group-hover:opacity-100',
            isMobileWidth() && props.isActive ? 'opacity-100' : 'opacity-0'
          )}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}

export function MessageTopRow(props: {
  authorId: string | null;
  date?: DateValue | null;
  deleteMessage?: () => void;
  enableEditing?: () => void;
  copyLink?: () => void;
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
      <div class="absolute top-0 right-0 flex flex-row bg-surface border border-edge-muted p-1 rounded-sm z-user-highlight">
        <Show when={props.copyLink}>
          <Button
            tooltip="Copy link to comment"
            size="icon-sm"
            variant="ghost"
            class="rounded-xs"
            onClick={props.copyLink}
          >
            <Link />
          </Button>
        </Show>
        <Show when={canComment()}>
          <Show when={props.isOwned}>
            <Show when={props.toggleResolve}>
              <Button
                tooltip="Resolve Comment"
                size="icon-sm"
                variant="ghost"
                class="rounded-xs"
                onClick={props.toggleResolve}
              >
                <Check />
              </Button>
            </Show>
            <Show when={props.enableEditing}>
              <Button
                tooltip="Edit Comment"
                size="icon-sm"
                variant="ghost"
                class="rounded-xs"
                onClick={props.enableEditing}
              >
                <NotePencil />
              </Button>
            </Show>
          </Show>
          <Show when={!props.isEditing && (props.isOwned || isDocumentOwner())}>
            <Button
              tooltip="Delete Comment"
              size="icon-sm"
              variant="ghost"
              class="rounded-xs"
              onClick={props.deleteMessage}
            >
              <Trash class="text-failure" />
            </Button>
          </Show>
        </Show>
      </div>
    </MessageRow>
  );
}
