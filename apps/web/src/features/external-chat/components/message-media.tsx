import { createMemo, mapArray, Show } from 'solid-js';
import { useExternalChat } from '../context/external-chat-context';
import { type InboundAttachment, inlineMediaKind } from '../core/attachments';
import { InboundMedia, type InboundMediaFile } from './inbound-media';

function sameMediaFile(
  a: InboundMediaFile | undefined,
  b: InboundMediaFile | undefined
): boolean {
  if (!a || !b) return a === b;
  return (Object.keys(a) as (keyof InboundMediaFile)[]).every(
    (key) => a[key] === b[key]
  );
}

/**
 * A message's images, video and voice notes, played inline. `sent` is what
 * this page showed for a file it sent: its local preview and size stand in
 * until the stored file loads.
 */
export function MessageMedia(props: {
  attachments: InboundAttachment[];
  sent?: InboundAttachment[];
}) {
  const source = useExternalChat();
  const media = createMemo(() =>
    props.attachments.flatMap((attachment, index) => {
      const local = props.sent?.[index];
      const file: InboundAttachment = local
        ? {
            ...attachment,
            previewUrl: attachment.previewUrl ?? local.previewUrl,
            width: attachment.width ?? local.width,
            height: attachment.height ?? local.height,
          }
        : attachment;
      const kind = inlineMediaKind(file);
      return kind ? [{ attachment: file, kind }] : [];
    })
  );
  const files = mapArray(
    () => media().map((file) => file.attachment.fileId ?? ''),
    (fileId, index) =>
      // One object per change, so Chat's media rows don't remount.
      createMemo(
        (): InboundMediaFile | undefined => {
          const file = media()[index()];
          if (!file) return undefined;
          return {
            id: fileId || `${file.attachment.ordinal}`,
            kind: file.kind,
            fileName: file.attachment.fileName,
            url: fileId ? source.fileUrl(fileId) : file.attachment.previewUrl,
            previewUrl: file.attachment.previewUrl,
            width: file.attachment.width,
            height: file.attachment.height,
            durationSeconds: file.attachment.durationSeconds,
            presentation: file.attachment.presentation,
          };
        },
        undefined,
        { equals: sameMediaFile }
      )
  );
  const shown = () => files().flatMap((file) => file() ?? []);
  return (
    <Show when={shown().length > 0}>
      <InboundMedia files={shown()} />
    </Show>
  );
}
