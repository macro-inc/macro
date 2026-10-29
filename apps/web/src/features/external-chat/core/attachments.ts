/** An imported provider file on a chat message, as DSS reports it. */
export type InboundAttachment = {
  ordinal: number;
  state: 'loading' | 'ready' | 'unavailable' | 'unsupported';
  fileName: string;
  mime: string;
  /** The static file holding it, once ready. */
  fileId: string | undefined;
  /** As the provider declared them, to reserve space before the file loads. */
  width?: number;
  height?: number;
  durationSeconds?: number;
  presentation?: 'sticker' | 'gif' | 'voice_note';
  /** The local preview of a file this page sent, before DSS stored it. */
  previewUrl?: string;
};

/** How a ready file plays inline, like Chat's media; undefined for a file chip. */
export function inlineMediaKind(
  attachment: InboundAttachment
): 'image' | 'video' | 'audio' | undefined {
  if (
    attachment.state !== 'ready' ||
    !(attachment.fileId || attachment.previewUrl)
  )
    return undefined;
  const type = attachment.mime.split('/')[0];
  if (type === 'image' || type === 'video' || type === 'audio') return type;
  return undefined;
}

/** Why a file can't go to this chat, by DSS's limits; undefined when it can. */
export function attachmentProblem(
  file: { name: string; type: string; size: number },
  limits: { attachmentTypes: string[]; attachmentBytes: number },
  /** The provider's name: "WhatsApp doesn't accept…". */
  label: string
): string | undefined {
  if (!limits.attachmentTypes.includes(file.type))
    return `${label} doesn't accept ${file.name}'s file type.`;
  if (file.size > limits.attachmentBytes)
    return `${file.name} is larger than ${label}'s ${Math.floor(limits.attachmentBytes / (1024 * 1024))} MB limit.`;
  return undefined;
}
