import { PayloadMode } from '@block-pdf/type/placeables';
import { createBlockEffect, createBlockSignal } from '@core/block';
import { placeableModeSignal } from './placeables';

export const disableOverlayClickSignal = createBlockSignal<boolean>(false);

export const disableViewerTextSelectionSignal =
  createBlockSignal<boolean>(false);

export const disablePageViewClickSignal = createBlockSignal<boolean>(false);

export const isSelectingViewerTextSignal = createBlockSignal<boolean>(false);

export const selectingCommentThreadSignal = createBlockSignal<number | null>(
  null
);

createBlockEffect(() => {
  const mode = placeableModeSignal.get;
  const selectionStarted = isSelectingViewerTextSignal.get;
  const disabled = mode() !== PayloadMode.NoMode || selectionStarted();

  disableOverlayClickSignal.set(disabled);
});

createBlockEffect(() => {
  const selectingViewer = isSelectingViewerTextSignal.get();
  if (selectingViewer) {
    selectingCommentThreadSignal.set(null);
  }
});

createBlockEffect(() => {
  const selectingCommentId = selectingCommentThreadSignal.get();
  disableViewerTextSelectionSignal.set(selectingCommentId != null);
});
