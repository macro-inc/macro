import { useUserId } from '@core/context/user';
import { createMemo, createSelector } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { isThreadPlaceable } from '../type/placeables';

export const useOwnedCommentPlaceableSelector = () => {
  const pdf = usePdfDocument();
  const userId = useUserId();
  const ownedCommentAnchorUuids = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) {
      console.error('User ID not found, cannot get owned comment placeables');
      return [];
    }

    const anchors = pdf.annotations.anchors();
    const owned =
      anchors
        ?.filter(
          (anchor) =>
            anchor.anchorType === 'placeable' && anchor.owner === currentUserId
        )
        .map((anchor) => anchor.uuid) ?? [];
    const newComment = pdf.markup.draft();
    if (
      newComment &&
      isThreadPlaceable(newComment) &&
      newComment.owner === currentUserId
    ) {
      owned.push(newComment.internalId);
    }
    return owned;
  });
  const ownedCommentSelector = createSelector(
    ownedCommentAnchorUuids,
    (uuid: string, owned) => (owned ?? []).includes(uuid)
  );
  return ownedCommentSelector;
};

export const useOwnedHighlightSelector = () => {
  const pdf = usePdfDocument();
  const userId = useUserId();
  const ownedHighlightSelector = createSelector(
    pdf.annotations.highlightsByUuid,
    (uuid: string, owned) => {
      if (!owned) return false;
      const highlight = owned[uuid];
      if (!highlight) return false;
      const owner = highlight.owner;
      if (!owner) return true;
      return owner === userId();
    }
  );
  return ownedHighlightSelector;
};
