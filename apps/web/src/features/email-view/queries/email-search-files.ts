import {
  createSoupSectionHeaderRow,
  type SoupSectionHeaderRow,
} from '@app/features/soup';
import type { DateValue } from '@core/util/date';
import {
  type EmailAttachment,
  type EmailEntity,
  isSearchEntity,
} from '@entity';

/** Files listed before "Show more" expands the section. */
export const EMAIL_SEARCH_FILES_PREVIEW_COUNT = 3;

/** An attachment of an email search result, with what the Files section shows. */
export type EmailSearchFile = {
  attachmentId: string;
  messageId?: string;
  filename: string;
  mimeType?: string;
  /** Every search term appears in the filename. */
  matchesQuery: boolean;
  sender?: string;
  sentAt?: DateValue;
  /** The search result the file belongs to. */
  thread: EmailEntity;
};

export type EmailFileRow = {
  kind: 'email-file';
  id: string;
  file: EmailSearchFile;
};

export type EmailFilesToggleRow = {
  kind: 'email-files-toggle';
  id: string;
  hiddenCount: number;
  expanded: boolean;
};

export type EmailSearchFilesItem =
  | SoupSectionHeaderRow
  | EmailFileRow
  | EmailFilesToggleRow;

const isCalendarFile = (attachment: EmailAttachment) =>
  attachment.mimeType === 'text/calendar' ||
  attachment.mimeType === 'application/ics' ||
  !!attachment.filename?.toLowerCase().endsWith('.ics');

// Without the body we cannot tell which parts it shows inline, so images with
// a Content-ID (signatures, logos, pasted screenshots) are treated as inline.
const isInlineImage = (attachment: EmailAttachment) =>
  !!attachment.contentId && !!attachment.mimeType?.startsWith('image/');

function searchTerms(query: string): string[] {
  return query.replaceAll('"', ' ').toLowerCase().split(/\s+/).filter(Boolean);
}

function emailHitsByMessage(thread: EmailEntity) {
  const hits = isSearchEntity(thread)
    ? (thread.search.contentHitData ?? [])
    : [];
  return new Map(
    hits.flatMap((hit) =>
      hit.type === 'email' ? [[hit.location.messageId, hit] as const] : []
    )
  );
}

function threadFiles(
  thread: EmailEntity,
  detail: EmailEntity,
  terms: readonly string[]
): EmailSearchFile[] {
  const hitsByMessage = emailHitsByMessage(thread);
  // Replies and forwards often carry the same file again.
  const seen = new Set<string>();

  return (detail.attachments ?? []).flatMap((attachment) => {
    const filename = attachment.filename?.trim();
    if (!filename || isCalendarFile(attachment) || isInlineImage(attachment))
      return [];
    const lowerName = filename.toLowerCase();
    const key = `${lowerName}:${attachment.sizeBytes ?? ''}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const hit = attachment.messageId
      ? hitsByMessage.get(attachment.messageId)
      : undefined;
    return [
      {
        attachmentId: attachment.id,
        messageId: attachment.messageId,
        filename,
        mimeType: attachment.mimeType ?? undefined,
        matchesQuery:
          terms.length > 0 && terms.every((term) => lowerName.includes(term)),
        sender: hit?.sender ?? (detail.senderName || detail.senderEmail),
        sentAt: hit?.sentAt ?? detail.sortTs ?? detail.updatedAt ?? undefined,
        thread,
      },
    ];
  });
}

/**
 * Attachments of the matched threads, in result order with filename matches
 * first. A file's sender and date come from the search hit on its message when
 * there is one, otherwise from the thread's latest message.
 */
export function collectEmailSearchFiles(
  threads: readonly EmailEntity[],
  details: ReadonlyMap<string, EmailEntity>,
  query: string
): EmailSearchFile[] {
  const terms = searchTerms(query);
  const uniqueThreads = [
    ...new Map(threads.map((thread) => [thread.id, thread])).values(),
  ];
  const files = uniqueThreads.flatMap((thread) => {
    const detail = details.get(thread.id);
    return detail ? threadFiles(thread, detail, terms) : [];
  });

  return [
    ...files.filter((file) => file.matchesQuery),
    ...files.filter((file) => !file.matchesQuery),
  ];
}

/** The Files section above search results; empty when no file matches. */
export function buildEmailSearchFileRows(
  files: readonly EmailSearchFile[],
  expanded: boolean
): EmailSearchFilesItem[] {
  if (files.length === 0) return [];

  const hiddenCount = files.length - EMAIL_SEARCH_FILES_PREVIEW_COUNT;
  const visible =
    expanded || hiddenCount <= 0
      ? files
      : files.slice(0, EMAIL_SEARCH_FILES_PREVIEW_COUNT);

  return [
    createSoupSectionHeaderRow('email-search-files', 'Files'),
    ...visible.map(
      (file): EmailFileRow => ({
        kind: 'email-file',
        id: `email-file:${file.attachmentId}`,
        file,
      })
    ),
    ...(hiddenCount > 0
      ? [
          {
            kind: 'email-files-toggle' as const,
            id: 'email-files-toggle',
            hiddenCount,
            expanded,
          },
        ]
      : []),
    createSoupSectionHeaderRow('email-search-threads', 'Emails'),
  ];
}
