import type { EmailAttachment } from './email-message';

/** Content-IDs compare without the angle brackets their MIME headers carry. */
export function normalizeContentId(contentId: string): string {
  return contentId.replace(/[<>]/g, '').trim();
}

/** Content-IDs of the attachments an HTML body shows inline through `cid:`. */
export function inlineContentIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(
    /<img\b[^>]*?\ssrc=["']cid:([^"']+)["']/gi
  )) {
    const id = normalizeContentId(match[1]);
    if (id) ids.add(id);
  }
  return ids;
}

/** Static-file ids of the attachments that have a copy there, by Content-ID. */
export function staticFileIdsByContentId(
  attachments: readonly EmailAttachment[] | null | undefined
): Map<string, string> {
  const fileIds = new Map<string, string>();
  for (const { content_id, sfs_id } of attachments ?? []) {
    if (content_id && sfs_id)
      fileIds.set(normalizeContentId(content_id), sfs_id);
  }
  return fileIds;
}
