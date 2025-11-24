import { EntityIcon } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isErr } from '@core/util/maybeResult';
import { uploadFile } from '@core/util/upload';
import X from '@icon/regular/x.svg';
import { emailClient } from '@service-email/client';
import type { Attachment } from '@service-email/generated/schemas/attachment';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { platformFetch } from 'core/util/platformFetch';
import { Show } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';

const mimeToFileExtTypeMap = new Map<string, string>(
  Object.values(FileTypeMap).map((value) => [value.mime, value.extension])
);

export function EmailAttachmentPill(props: {
  attachment: Attachment;
  removable?: boolean;
  onRemove?: () => void;
}) {
  let parentDiv!: HTMLDivElement;

  const { replaceOrInsertSplit } = useSplitLayout();

  const fileType = props.attachment.mime_type
    ? (mimeToFileExtTypeMap.get(props.attachment.mime_type) as FileType)
    : undefined;

  return (
    <div
      ref={parentDiv}
      class={`items-center text-xs flex flex-row ${props.removable ? 'pl-2' : 'p-2'} m-1 w-36 rounded border border-edge hover:bg-hover hover-transition-bg`}
      onclick={async () => {
        const dbId = props.attachment.db_id;
        if (!dbId) return;
        const response = await emailClient.getAttachmentUrl({ id: dbId });
        if (isErr(response)) return;

        const dataUrl = response[1].attachment.data_url;
        if (!dataUrl) return;
        const fileBlob = await platformFetch(dataUrl)
          .then((res) => res.blob())
          .then((blob) => {
            return blob;
          });
        const file = new File(
          [fileBlob],
          props.attachment.filename ?? 'EmailAttachment'
        );
        const uploadedFile = await uploadFile(file, 'dss');
        if (uploadedFile.failed || uploadedFile.type !== 'document') return;
        const blockName = fileTypeToBlockName(uploadedFile.fileType);
        replaceOrInsertSplit({
          type: blockName,
          id: uploadedFile.documentId,
        });
      }}
    >
      <Show when={fileType !== undefined || props.attachment.mime_type}>
        <EntityIcon
          targetType={fileType ?? (props.attachment.mime_type as FileType)}
          size="xs"
        />
      </Show>
      <div class="truncate ml-1">{props.attachment.filename}</div>
      <Show when={props.removable}>
        <div
          class="ml-auto p-2 hover:text-failure"
          onclick={(e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            if (props.onRemove) props.onRemove();
          }}
          onPointerEnter={() => {
            parentDiv.style.backgroundColor = 'var(--color-panel)';
          }}
          onPointerLeave={() => {
            parentDiv.style.backgroundColor = '';
          }}
        >
          <X width="14" />
        </div>
      </Show>
    </div>
  );
}
