import { LIST_VIEW_ID } from '@app/constants/list-views';
import { routeParams, type SplitLocation } from '@app/lib/split-router';
import { getIsSpecialProject } from '@block-project/isSpecial';
import type { SplitContent, SplitManager } from './layoutManager';

/**
 * The folder a split shows. A folder's own block names it as content; Drive
 * hosts folders on its route, so its content only names the view.
 */
function splitFolderId(content: SplitContent): string | undefined {
  if (content.type === 'project') {
    return getIsSpecialProject(content.id) ? undefined : content.id;
  }
  if (content.type !== 'component' || content.id !== LIST_VIEW_ID.documents) {
    return undefined;
  }
  const location = content.entryMetadata as SplitLocation | undefined;
  return routeParams<{ folderId?: string }>(location?.route).folderId;
}

/** Folders open in the layout's splits, in split order. */
export function openFolderIds(manager: SplitManager | undefined): string[] {
  return (
    manager?.splits().flatMap(({ content }) => splitFolderId(content) ?? []) ??
    []
  );
}
