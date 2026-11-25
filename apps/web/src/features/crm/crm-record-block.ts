import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import type { CrmMergeSurvivor, CrmRecordSection } from './core/record';

/** What a record block is sent when it opens: the Discussion message to show. */
export type CrmRecordBlockProps = { [COMMENT_LINK_PARAM]?: string };

/** The entry state a record block keeps its open section under. */
export function crmRecordSectionKey(record: CrmMergeSurvivor): string {
  return `crm.recordSection:${record.type}:${record.id}`;
}

/**
 * A record block showing the record a merged one went into, on the section
 * and Discussion message the merged one's page was showing.
 */
export function mergedRecordBlockContent(
  survivor: CrmMergeSurvivor,
  shown: { section: CrmRecordSection; commentId: string | undefined }
): SplitContent {
  const props: CrmRecordBlockProps | undefined = shown.commentId
    ? { [COMMENT_LINK_PARAM]: shown.commentId }
    : undefined;
  return {
    type: survivor.type,
    id: survivor.id,
    state: { [crmRecordSectionKey(survivor)]: shown.section },
    ...(props && { params: props }),
  };
}
