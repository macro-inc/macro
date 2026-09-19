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
  const [mode, setMode] = pdf.state.signals.placeableMode;
  const [activePlaceableId] = pdf.state.signals.activePlaceableId;
  const placeableIdMap = usePlaceableIdMap();
  const deletePlaceable = useDeletePlaceable();
  const showCancel = () => mode() !== PayloadMode.NoMode;
  const ownedCommentSelector = useOwnedCommentPlaceableSelector();
  const showDelete = createMemo(() => {
    const uuid = activePlaceableId();
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
              setMode(PayloadMode.FreeTextAnnotation);
            }}
          >
            <Textbox />
          </Button>
          <Button
            size="icon-sm"
            label="Signature"
            variant="ghost"
            onClick={() => setMode(PayloadMode.Signature)}
          >
            <Signature />
          </Button>
        </Show>
        <Button
          size="icon-sm"
          label="Comment"
          variant="ghost"
          onClick={() => {
            setMode(PayloadMode.Thread);
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
                  const activePlaceableIndex_ = activePlaceableId();
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
              setMode(PayloadMode.NoMode);
            }}
          >
            <Cancel />
          </Button>
        </Show>
      </div>
    </Show>
  );
}
