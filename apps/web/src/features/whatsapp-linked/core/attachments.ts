import { match, P } from 'ts-pattern';

/** WhatsApp's media categories for a linked-group send. */
export type MediaKind = 'image' | 'audio' | 'video' | 'document';

/** The category DSS sends a file type as; anything else is refused there. */
export function mediaKindOf(mimeType: string): MediaKind | undefined {
  return match(mimeType)
    .with(
      P.union('image/jpeg', 'image/png', 'image/webp'),
      () => 'image' as const
    )
    .with(
      P.union('audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/mp4'),
      () => 'audio' as const
    )
    .with('video/mp4', () => 'video' as const)
    .with(P.union('application/pdf', 'text/plain'), () => 'document' as const)
    .otherwise(() => undefined);
}

/** Why a file can't go to a WhatsApp group, or undefined when it can. */
export function attachmentProblem(
  file: { name: string; type: string; size: number },
  limitBytes: number
): string | undefined {
  if (!mediaKindOf(file.type))
    return `WhatsApp doesn't accept ${file.name}'s file type.`;
  if (file.size > limitBytes)
    return `${file.name} is larger than WhatsApp's ${Math.floor(limitBytes / (1024 * 1024))} MB limit.`;
  return undefined;
}

/** An imported WhatsApp file on a linked message, as DSS reports it. */
export type InboundAttachment = {
  ordinal: number;
  state: 'loading' | 'ready' | 'unavailable' | 'unsupported';
  fileName: string;
  /** The Macro document holding the file, once ready. */
  documentId: string | undefined;
};

/**
 * The person's own text of a message with imported files. DSS also writes a
 * text stand-in for the files ("Loading attachment…", "Attachment
 * unavailable: <name>") as its own paragraph, for search and notifications;
 * that stand-in is dropped where the files show themselves.
 */
export function captionOf(
  markdown: string,
  attachments: readonly InboundAttachment[]
): string {
  const standIns = new Set([
    'Loading attachment…',
    ...attachments.map(
      (attachment) => `Attachment unavailable: ${attachment.fileName}`
    ),
  ]);
  return markdown
    .split(/\n{2,}/)
    .filter((paragraph) => !standIns.has(paragraph.trim()))
    .join('\n\n')
    .trim();
}
