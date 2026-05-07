import { useOwnedCommentPlaceableSelector } from '@block-pdf/signal/permissions';
import {
  activePlaceableIdSignal,
  placeableModeSignal,
  showTabBarSignal,
} from '@block-pdf/signal/placeables';
import { isThreadPlaceable } from '@block-pdf/store/comments/freeComments';
import { LabelAndHotKey } from '@core/component/Tooltip';
import {
  useCanComment,
  useCanEdit,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import ChatTeardrop from '@icon/regular/chat-teardrop.svg';
import Signature from '@icon/regular/signature.svg';
import Tabs from '@icon/regular/tabs.svg';
import Textbox from '@icon/regular/textbox.svg';
import Trash from '@icon/regular/trash-simple.svg';
import Cancel from '@icon/regular/x.svg';
import { Button } from '@ui';
import { createMemo, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { placeableIdMap, useDeletePlaceable } from '../store/placeables';
import { PayloadMode } from '../type/placeables';

export function MarkupToolbar() {
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const isDocumentOwner = useIsDocumentOwner();

  const [mode, setMode] = placeableModeSignal;
  const [showTabBar, setShowTabBar] = showTabBarSignal;

  const activePlaceableId = activePlaceableIdSignal.get;
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

  const dynamicButtonMode = () => {
    if (showCancel()) return 'cancel';
    if (showDelete()) return 'delete';
    return 'placeholder';
  };

  const dynamicButton = createMemo(() => ({
    cancel: () => (
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
    ),
    delete: () => (
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
    ),
    placeholder: () => (
      <div class="invisible">
        <Button size="icon-sm">
          <Cancel />
        </Button>
      </div>
    ),
  }));

  return (
    <Show when={canComment()}>
      <div
        class="flex flex-row items-center"
        on:click={(e) => {
          e.stopPropagation();
        }}
      >
        <Show when={canEdit()}>
          <Button
            size="icon-sm"
            tooltip={
              <LabelAndHotKey
                label={showTabBar() ? 'Hide Tabs' : 'Show Tabs'}
              />
            }
            variant="ghost"
            onClick={() => {
              setShowTabBar(!showTabBar());
            }}
          >
            <Tabs />
          </Button>
          <div class="w-px h-5 bg-edge mx-2" />
          <Button
            size="icon-sm"
            tooltip={<LabelAndHotKey label="Text Box" />}
            variant="ghost"
            onClick={() => {
              setMode(PayloadMode.FreeTextAnnotation);
            }}
          >
            <Textbox />
          </Button>
          <Button
            size="icon-sm"
            tooltip={<LabelAndHotKey label="Signature" />}
            variant="ghost"
            onClick={() => setMode(PayloadMode.Signature)}
          >
            <Signature />
          </Button>
        </Show>
        <Button
          size="icon-sm"
          tooltip={<LabelAndHotKey label="Comment" />}
          variant="ghost"
          onClick={() => {
            setMode(PayloadMode.Thread);
          }}
        >
          <ChatTeardrop />
        </Button>
        <Dynamic component={dynamicButton()[dynamicButtonMode()]} />
      </div>
    </Show>
  );
}
