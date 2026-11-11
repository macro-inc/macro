import { useOwnedCommentPlaceableSelector } from '@block-pdf/signal/permissions';
import { isThreadPlaceable } from '@block-pdf/store/comments/freeComments';
import ChatTeardrop from '@icon/system/regular/chat-teardrop.svg';
import Signature from '@icon/system/regular/signature.svg';
import Textbox from '@icon/system/regular/textbox.svg';
import Trash from '@icon/system/regular/trash-simple.svg';
import Cancel from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { createMemo, Show } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { useDeletePlaceable, usePlaceableIdMap } from '../store/placeables';
import { PayloadMode } from '../type/placeables';

export function MarkupToolbar() {
  const pdf = usePdfDocument();
  const canEdit = pdf.permissions.canEdit;
  const canComment = pdf.permissions.canComment;
  const isDocumentOwner = pdf.permissions.isOwner;
  const placeableIdMap = usePlaceableIdMap();
  const deletePlaceable = useDeletePlaceable();
  const showCancel = () => pdf.markup.mode() !== PayloadMode.NoMode;
  const ownedCommentSelector = useOwnedCommentPlaceableSelector();
  const showDelete = createMemo(() => {
    const uuid = pdf.markup.activeId();
    if (!uuid) return false;
    const activePlaceable = placeableIdMap()?.[uuid];
    if (!activePlaceable) return false;
    if (isDocumentOwner()) return true;
    if (!isThreadPlaceable(activePlaceable)) return true;
    return ownedCommentSelector(uuid);
  });

  return (
    <Show when={canComment()}>
      <div class="flex flex-row items-center">
        <Show when={canEdit()}>
          <Button
            aria-label="Text Box"
            tooltip="Text Box"
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              pdf.markup.commands.beginPlacement(
                PayloadMode.FreeTextAnnotation
              );
            }}
          >
            <Textbox class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          </Button>
          <Button
            aria-label="Signature"
            tooltip="Signature"
            size="icon-sm"
            variant="ghost"
            onClick={() =>
              pdf.markup.commands.beginPlacement(PayloadMode.Signature)
            }
          >
            <Signature class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          </Button>
        </Show>
        <Button
          aria-label="Comment"
          tooltip="Comment"
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            pdf.markup.commands.beginPlacement(PayloadMode.Thread);
          }}
        >
          <ChatTeardrop class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
        <Show
          when={showCancel()}
          fallback={
            <Show
              when={showDelete()}
              fallback={
                <div class="invisible">
                  <Button variant="ghost" size="icon-sm">
                    <Cancel class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
                  </Button>
                </div>
              }
            >
              <Button
                size="icon-sm"
                variant="danger"
                tooltip="Delete"
                onClick={() => {
                  const activePlaceableIndex_ = pdf.markup.activeId();
                  if (activePlaceableIndex_ == null) return;
                  deletePlaceable(activePlaceableIndex_);
                }}
              >
                <Trash class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
              </Button>
            </Show>
          }
        >
          <Button
            size="icon-sm"
            variant="danger"
            tooltip="Cancel"
            onClick={() => {
              pdf.markup.commands.cancelPlacement();
            }}
          >
            <Cancel class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          </Button>
        </Show>
      </div>
    </Show>
  );
}
