import { UserIcon } from '@core/component/UserIcon';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { idToDisplayName } from '@core/user';
import { type DateValue, formatDate } from '@core/util/date';
import Check from '@phosphor/check.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import Link from '@phosphor/link.svg';
import NotePencil from '@phosphor/note-pencil.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { Button, cn, Dropdown } from '@ui';
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

function MessageRow(
  props: ParentProps<{
    authorId: string | null;
    date?: DateValue | null;
    hideBottomMargin?: boolean;
    nameSlot?: any;
    isActive: boolean;
    actionsVisible?: boolean;
    largeAvatar?: boolean;
  }>
) {
  return (
    <MessageRowUI
      authorId={props.authorId ?? 'Macro User'}
      date={props.date}
      hideBottomMargin={props.hideBottomMargin}
      nameSlot={props.nameSlot}
      isActive={props.isActive}
      actionsVisible={props.actionsVisible}
      largeAvatar={props.largeAvatar}
      children={props.children}
    />
  );
}

function MessageRowUI(
  props: ParentProps<{
    authorId: string;
    date?: DateValue | null;
    hideBottomMargin?: boolean;
    nameSlot?: any;
    hideBubble?: boolean;
    isActive: boolean;
    /** Keep the actions slot permanently visible instead of hover-revealed. */
    actionsVisible?: boolean;
    /** size-8 avatar instead of the compact size-4. */
    largeAvatar?: boolean;
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
          'flex items-center w-full flex-row gap-2 group-hover:truncate',
          props.isActive && 'truncate'
        )}
      >
        {!props.hideBubble && (
          <div
            class={cn(
              'relative flex items-center justify-center shrink-0 rounded-xs',
              props.largeAvatar ? 'size-8' : 'size-4'
            )}
          >
            <UserIcon
              // Avatar has no size-8 variant; "fill" adopts the wrapper size.
              size={props.largeAvatar ? 'fill' : 'sm'}
              suppressClick={true}
              id={props.authorId}
              isDeleted={false}
            />
          </div>
        )}
        <div class="text-xs touch:text-sm text-ink truncate grow">
          {displayName()}
        </div>
        <Show when={props.date}>
          <div class="text-xs touch:text-sm text-ink-placeholder">
            {formatDate(props.date)}
          </div>
        </Show>
      </div>
      <Show when={props.children}>
        <div
          class={cn(
            'items-center flex self-center group-hover:opacity-100',
            props.actionsVisible || (isMobileWidth() && props.isActive)
              ? 'opacity-100'
              : 'opacity-0'
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
  /**
   * Render the actions as an always-visible ellipsis dropdown at the row's
   * end instead of the hover-revealed overlay (the touch comment drawer,
   * where there is no hover).
   */
  actionsDropdown?: boolean;
}) {
  const { canComment, isDocumentOwner } = useContext(CommentsContext);

  const showEdit = () =>
    canComment() && props.isOwned && props.enableEditing != null;
  const showDelete = () =>
    canComment() &&
    !props.isEditing &&
    (props.isOwned || isDocumentOwner()) &&
    props.deleteMessage != null;

  if (props.actionsDropdown) {
    return (
      <MessageRow
        nameSlot={props.isNew && <NewTag />}
        authorId={props.authorId}
        date={props.date}
        hideBottomMargin={props.hideBottomMargin}
        isActive={props.isActive}
        actionsVisible
        largeAvatar
      >
        <Show when={props.copyLink != null || showEdit() || showDelete()}>
          <Dropdown>
            <Dropdown.Trigger
              variant="ghost"
              size="icon-sm"
              class="-my-1"
              aria-label="Comment actions"
            >
              <DotsThreeIcon />
            </Dropdown.Trigger>
            <Dropdown.Content portalScope="local">
              <Dropdown.Group>
                <Show when={props.copyLink}>
                  <Dropdown.Item onSelect={props.copyLink}>
                    <Link class="size-4" />
                    Copy link
                  </Dropdown.Item>
                </Show>
                <Show when={showEdit()}>
                  <Dropdown.Item onSelect={props.enableEditing}>
                    <NotePencil class="size-4" />
                    Edit comment
                  </Dropdown.Item>
                </Show>
                <Show when={showDelete()}>
                  <Dropdown.Item
                    class="text-failure-ink"
                    onSelect={props.deleteMessage}
                  >
                    <Trash class="size-4" />
                    Delete comment
                  </Dropdown.Item>
                </Show>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        </Show>
      </MessageRow>
    );
  }

  return (
    <MessageRow
      nameSlot={props.isNew && <NewTag />}
      authorId={props.authorId}
      date={props.date}
      hideBottomMargin={props.hideBottomMargin}
      isActive={props.isActive}
    >
      <div class="absolute top-0 right-0 flex flex-row bg-surface border border-edge-muted p-1 rounded-lg z-user-highlight shadow shadow-drop-shadow">
        <Show when={props.copyLink}>
          <Button
            tooltip="Copy link to comment"
            size="icon-sm"
            variant="ghost"
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
