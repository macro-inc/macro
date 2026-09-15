import { useUserId } from '@core/context/user';
import { createMemo, createSelector } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { isThreadPlaceable } from '../type/placeables';
import type { CommentId } from '@core/comments/commentType';

// true if user owns the comment placeable (by uuid)
export const useOwnedCommentPlaceableSelector = () => {
  const pdf = usePdfDocument();
  const userId = useUserId();
  const [anchors] = pdf.state.resources.anchors;
  const [newPlaceable] = pdf.state.signals.newPlaceable;
  const ownedCommentAnchorUuids = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) {
      console.error('User ID not found, cannot get owned comment placeables');
      return [];
    }

    const owned =
      anchors()
        ?.filter(
          (anchor) =>
            anchor.anchorType === 'placeable' && anchor.owner === currentUserId
        )
        .map((anchor) => anchor.uuid) ?? [];
    const newComment = newPlaceable();
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

export const useOwnedCommentSelector = () => {
  const pdf = usePdfDocument();
  const userId = useUserId();
  const [comments] = pdf.state.stores.comments;
  const ownedCommentIds = createMemo(() => {
    const currentUserId = userId();
    if (!currentUserId) {
      console.error('User ID not found, cannot get owned comments');
      return [];
    }
    return comments
      .filter((comment) => comment.owner === currentUserId)
      .map((comment) => comment.id);
  });
  const ownedCommentSelector = createSelector(
    ownedCommentIds,
    (id: CommentId, owned) => (owned ?? []).includes(id)
  );
  return ownedCommentSelector;
};

export const useOwnedHighlightSelector = () => {
  const pdf = usePdfDocument();
  const userId = useUserId();
  const highlightsUuidMap = pdf.state.derived.highlightsUuidMap;
  const ownedHighlightSelector = createSelector(
    highlightsUuidMap,
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
