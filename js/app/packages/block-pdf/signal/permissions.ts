import { commentsStore } from '@block-pdf/store/comments/commentStore';
import { commentPlaceables } from '@block-pdf/store/comments/freeComments';
import { highlightsUuidMap } from '@block-pdf/store/highlight';
import { createBlockMemo } from '@core/block';
import { useCanEdit } from '@core/signal/permissions';
import { useUserId } from '@service-gql/client';
import { createSelector } from 'solid-js';

export const useCanEditModificationData = useCanEdit;

const ownedCommentAnchorUuids = createBlockMemo(() => {
  const userId = useUserId()();
  if (!userId) {
    console.error('User ID not found, cannot get owned comment placeables');
    return [];
  }
  const owned =
    commentPlaceables()
      ?.filter((p) => p.owner === userId)
      .map((p) => p.internalId) ?? [];
  return owned;
});

const ownedCommentIds = createBlockMemo(() => {
  const userId = useUserId()();
  if (!userId) {
    console.error('User ID not found, cannot get owned comment placeables');
    return [];
  }
  const owned =
    Object.values(commentsStore.get ?? [])
      ?.filter((c) => c.owner === userId)
      .map((c) => c.id) ?? [];
  return owned;
});

// true if user owns the comment placeable (by uuid)
export const useOwnedCommentPlaceableSelector = () => {
  const ownedCommentSelector = createSelector(
    ownedCommentAnchorUuids,
    (uuid: string, owned) => (owned ?? []).includes(uuid)
  );
  return ownedCommentSelector;
};

export const useOwnedCommentSelector = () => {
  const ownedCommentSelector = createSelector(
    ownedCommentIds,
    (id: number, owned) => (owned ?? []).includes(id)
  );
  return ownedCommentSelector;
};

export const useOwnedHighlightSelector = () => {
  const userId = useUserId();
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
