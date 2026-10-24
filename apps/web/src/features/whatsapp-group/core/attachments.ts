/** An imported WhatsApp file on a group message, as DSS reports it. */
export type InboundAttachment = {
  ordinal: number;
  state: 'loading' | 'ready' | 'unavailable' | 'unsupported';
  fileName: string;
  mime: string;
  /** The Macro document holding the file, once ready. */
  documentId: string | undefined;
};

/** How a ready file plays inline, like Chat's media; undefined for a file chip. */
export function inlineMediaKind(
  attachment: InboundAttachment
): 'image' | 'video' | 'audio' | undefined {
  if (attachment.state !== 'ready' || !attachment.documentId) return undefined;
  const type = attachment.mime.split('/')[0];
  if (type === 'image' || type === 'video' || type === 'audio') return type;
  return undefined;
}

/** Why a file can't go to this WhatsApp group, by DSS's limits; undefined when it can. */
export function attachmentProblem(
  file: { name: string; type: string; size: number },
  limits: { attachmentTypes: string[]; attachmentBytes: number }
): string | undefined {
  if (!limits.attachmentTypes.includes(file.type))
    return `WhatsApp doesn't accept ${file.name}'s file type.`;
  if (file.size > limits.attachmentBytes)
    return `${file.name} is larger than WhatsApp's ${Math.floor(limits.attachmentBytes / (1024 * 1024))} MB limit.`;
  return undefined;
}
