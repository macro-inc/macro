import { useOwnedCommentPlaceableSelector } from '@block-pdf/signal/permissions';
import { isThreadPlaceable } from '@block-pdf/store/comments/freeComments';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import Signature from '@phosphor/signature.svg';
import Textbox from '@phosphor/textbox.svg';
import Trash from '@phosphor/trash-simple.svg';
import Cancel from '@phosphor/x.svg';
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
            size="icon-sm"
            label="Text Box"
            variant="ghost"
            onClick={() => {
              pdf.markup.commands.beginPlacement(
                PayloadMode.FreeTextAnnotation
              );
            }}
          >
            <Textbox />
          </Button>
          <Button
            size="icon-sm"
            label="Signature"
            variant="ghost"
            onClick={() =>
              pdf.markup.commands.beginPlacement(PayloadMode.Signature)
            }
          >
            <Signature />
          </Button>
        </Show>
        <Button
          size="icon-sm"
          label="Comment"
          variant="ghost"
          onClick={() => {
            pdf.markup.commands.beginPlacement(PayloadMode.Thread);
          }}
        >
          <ChatTeardrop />
        </Button>
        <Show
          when={showCancel()}
          fallback={
            <Show
              when={showDelete()}
              fallback={
                <div class="invisible">
                  <Button size="icon-sm">
                    <Cancel />
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
                <Trash />
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
            <Cancel />
          </Button>
        </Show>
      </div>
    </Show>
  );
}
