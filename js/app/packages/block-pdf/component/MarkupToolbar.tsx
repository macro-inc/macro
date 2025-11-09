import { useOwnedCommentPlaceableSelector } from '@block-pdf/signal/permissions';
import {
  activePlaceableIdSignal,
  placeableModeSignal,
  showTabBarSignal,
} from '@block-pdf/signal/placeables';
import { isThreadPlaceable } from '@block-pdf/store/comments/freeComments';
import { IconButton } from '@core/component/IconButton';
import { Tooltip } from '@core/component/Tooltip';
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
      <Tooltip tooltip={'Cancel'}>
        <IconButton
          size="sm"
          theme="red"
          icon={Cancel}
          onClick={() => {
            setMode(PayloadMode.NoMode);
          }}
        />
      </Tooltip>
    ),
    delete: () => (
      <Tooltip tooltip={'Delete'}>
        <IconButton
          size="sm"
          theme="red"
          icon={Trash}
          onClick={() => {
            const activePlaceableIndex_ = activePlaceableId();
            if (activePlaceableIndex_ == null) return;
            deletePlaceable(activePlaceableIndex_);
          }}
        />
      </Tooltip>
    ),
    placeholder: () => (
      <div class="invisible">
        <IconButton size="sm" icon={Cancel} />
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
          <IconButton
            size="sm"
            tooltip={{
              label: showTabBar() ? 'Hide Tabs' : 'Show Tabs',
            }}
            theme="clear"
            icon={Tabs}
            onClick={() => {
              setShowTabBar(!showTabBar());
            }}
          />
          <div class="w-px h-5 bg-edge mx-2" />
          <IconButton
            size="sm"
            tooltip={{
              label: 'Text Box',
            }}
            theme="clear"
            icon={Textbox}
            onClick={() => {
              setMode(PayloadMode.FreeTextAnnotation);
            }}
          />
          <IconButton
            size="sm"
            tooltip={{
              label: 'Signature',
            }}
            theme="clear"
            icon={Signature}
            onClick={() => setMode(PayloadMode.Signature)}
          />
        </Show>
        <IconButton
          size="sm"
          tooltip={{
            label: 'Comment',
          }}
          theme="clear"
          icon={ChatTeardrop}
          onClick={() => {
            setMode(PayloadMode.Thread);
          }}
        />
        <Dynamic component={dynamicButton()[dynamicButtonMode()]} />
      </div>
    </Show>
  );
}
