import { EntityIcon } from '@core/component/EntityIcon';
import X from '@icon/regular/x.svg';
import type { Attachment } from '@service-email/generated/schemas/attachment';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { Show } from 'solid-js';

const mimeToFileExtTypeMap = new Map<string, string>(
  Object.values(FileTypeMap).map((value) => [value.mime, value.extension])
);

export function EmailAttachmentPill(props: {
  attachment: Attachment;
  removable?: boolean;
  onRemove?: () => void;
  onClick: (attachment: Attachment, fileType?: FileType) => void;
}) {
  let parentDiv!: HTMLDivElement;

  const fileType = props.attachment.mime_type
    ? (mimeToFileExtTypeMap.get(props.attachment.mime_type) as FileType)
    : undefined;

  return (
    <div
      ref={parentDiv}
      class="items-center text-xs flex flex-row p-2 w-36 rounded border border-edge hover:bg-hover hover-transition-bg"
      classList={{
        'pl-2': props.removable,
      }}
      onclick={() => props.onClick(props.attachment, fileType)}
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
