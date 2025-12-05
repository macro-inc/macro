import { EntityIcon } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isErr } from '@core/util/maybeResult';
import X from '@icon/regular/x.svg';
import { queryKeys, useQueryClient } from '@macro-entity';
import { logger } from '@observability';
import { emailClient } from '@service-email/client';
import type { Attachment } from '@service-email/generated/schemas/attachment';
import { storageServiceClient } from '@service-storage/client';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
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
  const entityQueryClient = useQueryClient();

  const fileType = props.attachment.mime_type
    ? (mimeToFileExtTypeMap.get(props.attachment.mime_type) as FileType)
    : undefined;

  const clickHandler = async () => {
    const dbId = props.attachment.db_id;
    if (!dbId) return;
    const response = await emailClient.getOrCreateAttachmentDocumentId({
      id: dbId,
    });
    if (isErr(response)) {
      toast.failure('Failed to get attachment. Please try again.');
      return logger.error('Failed to get or create attachment document id', {
        error: new Error(
          'Failed to get or create attachment document id: ' + response[0]
        ),
      });
    }
    const { document_id } = response[1];

    const maybeDocumentMetadata =
      await storageServiceClient.getDocumentMetadata({
        documentId: document_id,
      });
    if (isErr(maybeDocumentMetadata)) {
      toast.failure('Failed to get attachment. Please try again.');
      return logger.error(
        'Failed to get or create attachment document metadata',
        {
          error: new Error(
            'Failed to get or create attachment document metadata: ' +
              maybeDocumentMetadata[0]
          ),
        }
      );
    }

    entityQueryClient.invalidateQueries({
      queryKey: queryKeys.all.dss,
    });

    const blockName = fileTypeToBlockName(fileType);
    replaceOrInsertSplit({
      type: blockName,
      id: document_id,
    });
  };

  return (
    <div
      ref={parentDiv}
      class={`items-center text-xs flex flex-row ${props.removable ? 'pl-2' : 'p-2'} m-1 w-36 rounded border border-edge hover:bg-hover hover-transition-bg`}
      onclick={clickHandler}
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
