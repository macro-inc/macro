import { createSearchParams } from '@app/lib/split-router';
import { useEntryState } from '@components/app/split-layout/entry-state';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { untrack } from 'solid-js';
import { z } from 'zod';
import {
  COMPANY_SECTIONS,
  CONTACT_SECTIONS,
  type CompanySection,
  type ContactSection,
  type CrmMergeSurvivor,
  type CrmRecordSection,
} from './core/record';

/** What a record block is sent when it opens: the Discussion message to show. */
export type CrmRecordBlockProps = { [COMMENT_LINK_PARAM]?: string };

/** The section a link opens a record's own page on; the page reads it once. */
export const crmRecordSectionSearch = {
  namespace: 'crm-section',
  schema: z.object({ section: z.string() }),
  defaults: { section: '' },
};

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

type RecordSection<T extends CrmMergeSurvivor['type']> = T extends 'company'
  ? CompanySection
  : ContactSection;

/**
 * The section a record's own page shows, kept with its history entry. A link
 * that names a section, as a Customers record URL does when a phone opens it
 * on the record's page, opens on it once and then leaves the URL.
 */
export function createRecordSection<
  T extends CrmMergeSurvivor['type'],
>(record: { type: T; id: string }) {
  const sections: readonly string[] =
    record.type === 'company' ? COMPANY_SECTIONS : CONTACT_SECTIONS;
  const [link, setLink] = createSearchParams(crmRecordSectionSearch);
  const linked = untrack(() => link.section);
  const [section, setSection] = useEntryState<RecordSection<T>>(
    crmRecordSectionKey(record),
    { default: 'overview' as RecordSection<T> }
  );
  if (linked) {
    // A section this record type lacks opens Overview, not a restored one.
    setSection(() =>
      sections.includes(linked)
        ? (linked as RecordSection<T>)
        : ('overview' as RecordSection<T>)
    );
    setLink({ section: '' }, { history: 'replace' });
  }
  return [section, setSection] as const;
}
